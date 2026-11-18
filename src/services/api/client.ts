import { readMessageEvent } from './parseEvent.js'
import {
  FILES_PROVIDER,
  filesUrl,
  messagesUrl,
  chatCompletionsUrl,
  type ApiAuth,
  type ProviderProfile,
} from './providers.js'
import { readServerSentEvents } from './sse.js'
import { streamChatCompletion } from './openai.js'
import { ApiError } from './error.js'
import { isErrorBody, readErrorResponse, request } from './http.js'
import type {
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
} from './types.js'

export { ApiError, type ApiErrorKind } from './error.js'

/** 构建期 API 地址，默认 https://api.deepseek.com；语音接口（仅 DeepSeek 提供）使用该地址 */
export const API_ORIGIN = __API_ORIGIN__
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

export type { ApiAuth } from './providers.js'

export { request }

/** 发给 Anthropic 端点前剔除只属于 Chat Completions 的字段 */
const omitOpenAIOnly = (body: CreateMessageRequest): CreateMessageRequest => {
  const payload = { ...body }
  delete payload.reasoning_effort
  return payload
}

/** 会话端点：Anthropic 是 /messages，OpenAI 是 /chat/completions */
const conversationUrl = (provider: ProviderProfile) =>
  provider.protocol === 'openai' ? chatCompletionsUrl(provider) : messagesUrl(provider)

/**
 * Anthropic 协议请求头：鉴权按供应商决定（x-api-key 或 Bearer），
 * 需要版本头的端点补 anthropic-version；beta 只在供应商支持 Files API 时携带。
 */
const anthropicHeaders = (
  { provider, apiKey }: ApiAuth,
  beta: boolean
): Record<string, string> => ({
  ...(provider.auth === 'bearer'
    ? { Authorization: `Bearer ${apiKey}` }
    : // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
      { 'x-api-key': apiKey }),
  ...(provider.anthropicVersion ? { 'anthropic-version': provider.anthropicVersion } : {}),
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta && provider.features.files ? { 'anthropic-beta': FILES_BETA } : {}),
})

/**
 * 校验 API Key（不产生对话费用）。
 * 有 verifyPath 时用 GET；否则发一条 max_tokens 为 1 的最小请求。
 * 只有 401 / 403 说明 Key 本身不对；404、400、429 多为「该接口不存在」或请求被拒，
 * 说明鉴权已通过（部分服务的 models 接口并不存在），放行保存。
 */
export const verifyApiKey = async (
  provider: ProviderProfile,
  apiKey: string,
  signal?: AbortSignal
): Promise<void> => {
  const url = provider.verifyPath
    ? `${provider.baseUrl}${provider.verifyPath}`
    : conversationUrl(provider)
  const init: RequestInit = provider.verifyPath
    ? { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, signal }
    : {
        method: 'POST',
        headers: {
          ...anthropicHeaders({ provider, apiKey }, false),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: provider.defaultModel || provider.models[0]?.id || '',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal,
      }
  try {
    await request(url, init)
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status !== undefined &&
      error.status !== 401 &&
      error.status !== 403 &&
      error.status < 500
    ) {
      return
    }
    throw error
  }
}

/**
 * POST {prefix}/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * Files API 只有 DeepSeek 兼容端点提供，地址与环境固定用该供应商；
 * purpose 为 null 时不传该字段（图片），purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(filesUrl(FILES_PROVIDER), {
    method: 'POST',
    headers: anthropicHeaders({ provider: FILES_PROVIDER, apiKey }, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE {prefix}/files/{file_id}；同样只走 DeepSeek 兼容端点 */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  await request(`${filesUrl(FILES_PROVIDER)}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders({ provider: FILES_PROVIDER, apiKey }, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * POST {prefix}/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * 请求体已按供应商能力裁剪，这里只补 stream。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamMessage(
  auth: ApiAuth,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  // OpenAI 兼容通道把同一份请求体转换后发出，事件统一翻译成内部块事件
  if (auth.provider.protocol === 'openai') {
    yield* streamChatCompletion(auth, body, signal)
    return
  }
  const response = await request(messagesUrl(auth.provider), {
    method: 'POST',
    headers: {
      ...anthropicHeaders(auth, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    // reasoning_effort 是 OpenAI 协议的字段，Anthropic 端点不认识（部分服务会 400）
    body: JSON.stringify({ ...omitOpenAIOnly(body), stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}
