import { create } from 'zustand'
import type { ModelOption, ProviderId, ProviderProfile } from './providers.js'
import { applyDiscoveredModel, hasExplicitModel, resolveProvider, useSettings } from '../settings.js'

/**
 * 运行时发现供应商的模型列表：GET {baseUrl}{modelsPath}。
 * 只用于与 messages 端点同一 surface 的供应商，内置列表作为默认值与失败兜底；
 * 结果按供应商缓存在 localStorage，24 小时内不重复请求。
 */

const CACHE_TTL = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT = 10_000
const cacheKey = (id: ProviderId) => `chat-demo:models:${id}`

export type ModelsStatus = 'idle' | 'loading' | 'ready' | 'error'

/** 失败原因：界面据此给出可操作的提示 */
export type ModelsErrorKind = 'auth' | 'notFound' | 'format' | 'network'

type ModelsState = {
  status: ModelsStatus
  models: ModelOption[]
  error?: ModelsErrorKind
}

class ModelsError extends Error {
  readonly kind: ModelsErrorKind

  constructor(kind: ModelsErrorKind) {
    super(kind)
    this.kind = kind
  }
}

/** 供应商是动态的，状态表按需创建 */

export const useModels = create<Record<ProviderId, ModelsState>>(() => ({}))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const readCache = (
  id: ProviderId,
  baseUrl: string
): { models: ModelOption[]; fetchedAt: number } | null => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(cacheKey(id)) ?? 'null')
    // 地址被改过（自建网关、本地 Ollama）时旧缓存作废
    if (
      !isRecord(parsed) ||
      !Array.isArray(parsed.models) ||
      typeof parsed.fetchedAt !== 'number' ||
      parsed.baseUrl !== baseUrl
    ) {
      return null
    }
    const models = parsed.models.filter(
      (item): item is ModelOption =>
        isRecord(item) && typeof item.id === 'string' && typeof item.label === 'string'
    )
    return models.length > 0 ? { models, fetchedAt: parsed.fetchedAt } : null
  } catch {
    return null
  }
}

const writeCache = (id: ProviderId, models: ModelOption[], baseUrl: string) => {
  try {
    localStorage.setItem(cacheKey(id), JSON.stringify({ models, fetchedAt: Date.now(), baseUrl }))
  } catch {
    // 存储不可用时只在本次会话内生效
  }
}

/** 协议对应的会话端点，用于过滤 supported_endpoints */
const CONVERSATION_PATH = { anthropic: '/messages', openai: '/chat/completions' } as const

/** OpenAI 兼容目录里混着向量、语音、图像模型，按名字排除明显不能对话的 */
const NON_CHAT_MODEL = /(embedding|moderation|whisper|tts|dall-e|transcribe|realtime|audio|image|rerank|guard)/i

/**
 * 兼容三种返回格式：数组、{ data: [...] }（Anthropic / OpenAI 风格）、{ models: [...] }。
 * 条目可以是字符串或对象，取 id、display_name、name；
 * 带 supported_endpoints 时只保留支持当前协议会话端点的模型（如 Command Code 的目录）。
 */
const parseModels = (body: unknown, provider: ProviderProfile): ModelOption[] => {
  const list = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.data)
      ? body.data
      : isRecord(body) && Array.isArray(body.models)
        ? body.models
        : []
  const models: ModelOption[] = []
  for (const item of list) {
    if (typeof item === 'string') {
      models.push({ id: item, label: item })
      continue
    }
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id) {
      continue
    }
    const endpoints = item.supported_endpoints
    if (Array.isArray(endpoints) && !endpoints.includes(CONVERSATION_PATH[provider.protocol])) {
      continue
    }
    if (provider.protocol === 'openai' && NON_CHAT_MODEL.test(item.id)) {
      continue
    }
    const label =
      (typeof item.display_name === 'string' && item.display_name) ||
      (typeof item.name === 'string' && item.name) ||
      item.id
    models.push({ id: item.id, label })
  }
  return models
}

/** 用户没手动选过模型时，用远端列表的默认项替换内置默认值 */
const adoptDefaultModel = (provider: ProviderProfile, models: ModelOption[]) => {
  if (hasExplicitModel(provider.id)) {
    return
  }
  const current = useSettings.getState().providers[provider.id]?.model ?? ''
  if (models.some((item) => item.id === current)) {
    return
  }
  const preferred = models.find((item) => item.id === provider.defaultModel) ?? models[0]
  if (preferred) {
    applyDiscoveredModel(provider.id, preferred.id)
  }
}

/** 正在请求的「供应商 + 地址」；换地址后允许立即为新地址发起请求 */
const inflight = new Set<string>()

/**
 * 拉取模型列表。已有缓存时先展示缓存，超过 TTL 再后台刷新；
 * force 用于手动刷新（如刚保存了新的 API Key）。无 modelsPath 或无 Key 时不做任何事。
 */
export const loadModels = async (providerId: ProviderId, force = false): Promise<void> => {
  // 用合并了用户自定义地址的画像，改过地址后请求发往新地址
  const provider = resolveProvider(providerId)
  if (!provider.modelsPath) {
    return
  }
  // 没有 Key 也尝试一次：部分服务的 /models 是公开的（如自建网关、本地 Ollama）
  const apiKey = useSettings.getState().providers[providerId]?.apiKey ?? ''
  const cached = readCache(providerId, provider.baseUrl)
  if (cached) {
    useModels.setState((state) => ({
      ...state,
      [providerId]: { status: 'ready', models: cached.models },
    }))
    if (!force && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return
    }
  }
  const requestKey = `${providerId}:${provider.baseUrl}`
  if (inflight.has(requestKey)) {
    return
  }
  inflight.add(requestKey)
  // 记住发起时的地址：响应回来时地址若已改变（用户继续改 URL），结果作废，避免旧地址覆盖新地址
  const targetBaseUrl = provider.baseUrl
  const isStale = () => resolveProvider(providerId).baseUrl !== targetBaseUrl
  useModels.setState((state) => ({
    ...state,
    [providerId]: { status: 'loading', models: cached?.models ?? state[providerId]?.models ?? [] },
  }))
  try {
    const response = await fetch(`${provider.baseUrl}${provider.modelsPath}`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal:
        typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT) : undefined,
    })
    if (response.status === 401 || response.status === 403) {
      throw new ModelsError('auth')
    }
    if (response.status === 404) {
      throw new ModelsError('notFound')
    }
    if (!response.ok) {
      throw new ModelsError('format')
    }
    const models = parseModels(await response.json(), provider)
    if (models.length === 0) {
      // 200 但不是模型列表（例如把 Anthropic 地址填进了 OpenAI 兼容）
      throw new ModelsError('format')
    }
    if (isStale()) {
      return
    }
    writeCache(providerId, models, provider.baseUrl)
    useModels.setState((state) => ({ ...state, [providerId]: { status: 'ready', models } }))
    adoptDefaultModel(provider, models)
  } catch (error) {
    if (isStale()) {
      return
    }
    // 同地址的缓存可以继续展示；换了地址则清空，避免把上一个地址的模型留在下拉里
    const models = cached?.models ?? []
    // 当前模型不属于这个地址的可用列表时回落到内置默认值，否则一发请求就是 400
    const current = useSettings.getState().providers[providerId]?.model ?? ''
    if (![...models, ...provider.models].some((item) => item.id === current)) {
      applyDiscoveredModel(providerId, provider.defaultModel)
    }
    useModels.setState((state) => ({
      ...state,
      [providerId]: {
        status: 'error',
        models,
        error: error instanceof ModelsError ? error.kind : 'network',
      },
    }))
  } finally {
    inflight.delete(requestKey)
  }
}

/** 界面用：优先远端列表，没有时回落到内置列表（自定义服务没有内置列表） */
export const useModelOptions = (provider: ProviderProfile): ModelOption[] => {
  const discovered = useModels((state) => state[provider.id])
  return discovered && discovered.models.length > 0
    ? discovered.models
    : [...provider.models]
}

/**
 * 按用户勾选的可见集合过滤，visible 为 null 表示全部可见。
 * 当前选中的模型始终保留，否则选择器会显示成「未选择」。
 */
export const applyVisibility = (
  models: ModelOption[],
  visible: string[] | null | undefined,
  current?: string
): ModelOption[] => {
  const result = visible ? models.filter((item) => visible.includes(item.id)) : [...models]
  // 只有明确传入当前模型时才补一条（设置里要保留「自定义模型」的编辑态，因此不传）
  if (current && !result.some((item) => item.id === current)) {
    result.unshift(models.find((item) => item.id === current) ?? { id: current, label: current })
  }
  return result
}

/** 组件内直接取「远端/兜底 + 用户可见性」过滤后的列表 */
export const useVisibleModelOptions = (
  provider: ProviderProfile,
  current?: string
): ModelOption[] => {
  const models = useModelOptions(provider)
  const visible = useSettings((state) => state.visibleModels[provider.id] ?? null)
  return applyVisibility(models, visible, current)
}

/** 界面用：远端列表的状态与失败原因，用于提示加载失败 */
export const useModelsStatus = (provider: ProviderProfile): ModelsStatus =>
  useModels((state) => state[provider.id]?.status ?? 'idle')

export const useModelsError = (provider: ProviderProfile): ModelsErrorKind | undefined =>
  useModels((state) => state[provider.id]?.error)

/** 删除服务后清掉它的列表缓存，重新添加同名地址时不会命中旧数据 */
export const forgetModels = (providerId: ProviderId) => {
  useModels.setState((state) =>
    Object.fromEntries(Object.entries(state).filter(([key]) => key !== providerId))
  )
  try {
    localStorage.removeItem(cacheKey(providerId))
  } catch {
    // 存储不可用时只影响缓存
  }
}
