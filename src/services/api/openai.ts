import { ApiError } from './error.js'
import { isErrorBody, readErrorResponse, request } from './http.js'
import { chatCompletionsUrl, type ApiAuth } from './providers.js'
import { readServerSentEvents } from './sse.js'
import type {
  CreateMessageRequest,
  MessageStreamEvent,
  MessageUsage,
  StopReason,
  TextBlockParam,
} from './types.js'

/**
 * OpenAI Chat Completions 通道：把内部的 Anthropic 风格请求体转成 Chat Completions 请求，
 * 再把 SSE 增量翻译回内部块事件，使 store / UI / 存储逻辑完全不用区分协议。
 */

type ChatContent = string | { type: 'text'; text: string }[]
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: ChatContent }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const EMPTY_USAGE: MessageUsage = {
  input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 0,
}

/**
 * 内部 messages → Chat Completions messages。
 * latest_reminder 是服务端扩展角色，这里直接丢弃；附件块引用的 file_id 无法转换，同样跳过。
 */
const toChatMessages = (messages: CreateMessageRequest['messages']): ChatMessage[] => {
  const result: ChatMessage[] = []
  for (const message of messages) {
    if (message.role === 'latest_reminder') {
      continue
    }
    if (message.role === 'user') {
      if (typeof message.content === 'string') {
        if (message.content) {
          result.push({ role: 'user', content: message.content })
        }
        continue
      }
      const text = message.content
        .filter((block): block is TextBlockParam => block.type === 'text')
        .map((block) => block.text)
        .join('\n\n')
      if (text) {
        result.push({ role: 'user', content: text })
      }
      continue
    }
    // 助手历史只回传正文；思考块与工具块在 Chat Completions 里没有对应结构
    const text = message.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
    if (text.trim()) {
      result.push({ role: 'assistant', content: text })
    }
  }
  return result
}

const toChatBody = (body: CreateMessageRequest) => ({
  model: body.model,
  messages: [
    ...(body.system ? [{ role: 'system', content: body.system }] : []),
    ...toChatMessages(body.messages),
  ],
  ...(body.max_tokens ? { max_tokens: body.max_tokens } : {}),
  stream: true,
  // 不传 stream_options：部分兼容网关（旧版 Ollama、第三方代理）会因未知字段返回 400，
  // 而用量当前没有界面展示；服务端自愿下发 usage 时仍会解析。
})

const toStopReason = (finishReason: unknown): StopReason => {
  switch (finishReason) {
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'content_filter':
      return 'refusal'
    default:
      return 'end_turn'
  }
}

/** OpenAI 用量字段 → 内部用量结构；缺省的缓存字段按 0 处理 */
const toUsage = (value: unknown): MessageUsage | undefined => {
  if (!isRecord(value) || typeof value.prompt_tokens !== 'number') {
    return undefined
  }
  const details = isRecord(value.prompt_tokens_details) ? value.prompt_tokens_details : undefined
  return {
    input_tokens: value.prompt_tokens,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens:
      details && typeof details.cached_tokens === 'number' ? details.cached_tokens : 0,
    output_tokens: typeof value.completion_tokens === 'number' ? value.completion_tokens : 0,
  }
}

/** delta 里的正文：有的服务用字符串，有的用 [{ type: 'text', text }] 数组 */
const readText = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    return ''
  }
  return value
    .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
    .join('')
}

/** 推理增量：OpenAI 系多为 reasoning_content，部分兼容服务用 reasoning */
const readReasoning = (delta: Record<string, unknown>): string =>
  typeof delta.reasoning_content === 'string'
    ? delta.reasoning_content
    : typeof delta.reasoning === 'string'
      ? delta.reasoning
      : ''

/**
 * POST {baseUrl}/chat/completions（stream: true），把增量翻译成块事件：
 * 正文与推理各开一个块，切换类型时先关上一个；结束时补 message_delta 与 message_stop。
 */
export async function* streamChatCompletion(
  auth: ApiAuth,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(chatCompletionsUrl(auth.provider), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(toChatBody(body)),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }

  yield { type: 'message_start', message: { id: '', model: body.model, usage: EMPTY_USAGE } }

  let index = -1
  let open: 'text' | 'thinking' | null = null
  let finishReason: unknown
  let usage: MessageUsage | undefined
  let received = false

  const closeBlock = (): MessageStreamEvent | null => {
    if (open === null) {
      return null
    }
    open = null
    return { type: 'content_block_stop', index }
  }

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    if (data.trim() === '[DONE]') {
      break
    }
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      continue
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (!isRecord(payload)) {
      continue
    }
    const chunkUsage = toUsage(payload.usage)
    if (chunkUsage) {
      usage = chunkUsage
    }
    const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined
    if (!isRecord(choice)) {
      continue
    }
    if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
      finishReason = choice.finish_reason
    }
    const delta = isRecord(choice.delta) ? choice.delta : undefined
    if (!delta) {
      continue
    }

    const reasoning = readReasoning(delta)
    if (reasoning) {
      received = true
      if (open !== 'thinking') {
        const stopped = closeBlock()
        if (stopped) {
          yield stopped
        }
        index += 1
        open = 'thinking'
        yield {
          type: 'content_block_start',
          index,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        }
      }
      yield { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: reasoning } }
    }

    const text = readText(delta.content)
    if (text) {
      received = true
      if (open !== 'text') {
        const stopped = closeBlock()
        if (stopped) {
          yield stopped
        }
        index += 1
        open = 'text'
        yield { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }
      }
      yield { type: 'content_block_delta', index, delta: { type: 'text_delta', text } }
    }
  }

  // 中止时不补结束事件，交由调用方按「已停止」收尾
  signal.throwIfAborted()
  if (!received && finishReason === undefined && !usage) {
    throw new ApiError('interrupted', '')
  }

  const stopped = closeBlock()
  if (stopped) {
    yield stopped
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: toStopReason(finishReason), stop_sequence: null },
    usage,
  }
  yield { type: 'message_stop' }
}
