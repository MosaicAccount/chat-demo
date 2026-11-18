/**
 * 供应商画像：内置 DeepSeek 走 Anthropic Messages，用户添加的服务统一走 OpenAI Chat Completions。
 * 各家差异收敛为地址、鉴权方式与能力位；请求体按能力位裁剪，协议解析层不做区分。
 */

/**
 * 供应商 id：内置的 'deepseek'，或用户添加的服务（'custom-…'）。
 * 旧版留下的 'openai' 会在迁移时变成一个自定义服务。
 */
export type ProviderId = string

/** 传输协议：Anthropic Messages 或 OpenAI Chat Completions，请求体在适配层转换 */
export type Protocol = 'anthropic' | 'openai'

/** 能力位：为 false 时不发送对应字段，界面隐藏或禁用相应入口 */
export type ProviderFeatures = {
  /** thinking 参数 */
  thinking: boolean
  /** deepseek_web_search 服务端工具 */
  search: boolean
  /** deepseek_read_url 服务端工具（链接阅读） */
  readLink: boolean
  /** message_delta 的 title 扩展，用于自动命名会话 */
  title: boolean
  /** safety_check 扩展 */
  safetyCheck: boolean
  /** latest_reminder 角色：注入时间与位置快照 */
  latestReminder: boolean
  /** Files API：附件上传与 file_id 引用 */
  files: boolean
  /** ASR / TTS 语音能力 */
  speech: boolean
}

/** 一次请求的供应商与密钥；供应商决定地址、鉴权方式与请求扩展 */
export type ApiAuth = {
  provider: ProviderProfile
  apiKey: string
}

export type ModelOption = {
  id: string
  /** 展示名，品牌名不翻译 */
  label: string
}

export type ProviderProfile = {
  id: ProviderId
  /** 服务名，品牌名不翻译；自定义服务用用户填写的名字 */
  name: string
  protocol: Protocol
  /** API 根地址，不带尾部斜杠 */
  baseUrl: string
  /** Anthropic 的版本前缀，拼在 baseUrl 之后；OpenAI 协议的地址已含版本段，留空 */
  pathPrefix: string
  /**
   * 思考深度用哪个参数表达：DeepSeek 是 output_config.effort，
   * OpenAI 兼容通道是 reasoning_effort。缺省表示该服务没有推理开关。
   */
  reasoningParam?: 'output_config' | 'reasoning_effort'
  /** 用户可改地址：内置供应商为 false，自定义服务为 true */
  editable: boolean
  /** 鉴权方式：DeepSeek 用 x-api-key，其余用 Authorization: Bearer */
  auth: 'x-api-key' | 'bearer'
  /** 需要 anthropic-version 请求头的端点；DeepSeek 兼容端点不需要 */
  anthropicVersion?: string
  /** 助手身份说明；null 时不发送 system */
  system: string | null
  /** 内置模型列表：作为默认值与拉取失败时的兜底 */
  models: readonly ModelOption[]
  /** 未选模型时的默认值；空串表示必须由模型列表或用户决定 */
  defaultModel: string
  /** GET 模型列表的路径（拼接 baseUrl） */
  modelsPath?: string
  /** Anthropic 协议要求 max_tokens 必填；0 表示沿用服务端默认，不发送该字段 */
  maxTokens: number
  /** GET 校验 Key 的路径（拼接 baseUrl） */
  verifyPath?: string
  features: ProviderFeatures
}

/** 用户添加的 OpenAI 兼容服务；Key 与模型仍按 id 存在设置里 */
export type CustomProviderConfig = {
  id: ProviderId
  /** 空串时界面用主机名兜底 */
  name: string
  baseUrl: string
  /** 来自哪个内置预设；决定拉取失败时的兜底模型列表 */
  preset?: string
}

export type PresetId = 'openai' | 'commandcode' | 'ollama' | 'siliconflow'

export type ProviderPreset = {
  id: PresetId
  name: string
  /** OpenAI 兼容地址，含版本段 */
  baseUrl: string
  /** 拉取失败时展示的兜底模型；能拉到远端列表时以远端为准 */
  models: ModelOption[]
}

/** 内置预设：省去手填地址，并带上正确口径与兜底模型 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini' },
      { id: 'gpt-4o', label: 'gpt-4o' },
    ],
  },
  {
    id: 'commandcode',
    name: 'Command Code',
    baseUrl: 'https://api.commandcode.ai/provider/v1',
    models: [],
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [],
  },
  {
    id: 'ollama',
    name: '本地 Ollama',
    baseUrl: 'http://localhost:11434/v1',
    models: [],
  },
]

export const getPreset = (id: unknown): ProviderPreset | undefined =>
  typeof id === 'string' ? PROVIDER_PRESETS.find((preset) => preset.id === id) : undefined

/** 已有配置没有 preset 字段时，按地址反查，让老配置也拿到兜底模型 */
export const matchPresetByUrl = (baseUrl: string): ProviderPreset | undefined => {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  return PROVIDER_PRESETS.find((preset) => preset.baseUrl === normalized)
}

/** 构建期注入的 API 地址，作为 DeepSeek 供应商的根地址，可用 createConfig({ apiOrigin }) 改成自建网关 */
const DEFAULT_ORIGIN = __API_ORIGIN__

/** 仅 DeepSeek 走 Anthropic Messages：它的搜索、引用、Files API、标题扩展都只在这一面提供 */
const deepseek: ProviderProfile = {
  id: 'deepseek',
  name: 'DeepSeek',
  protocol: 'anthropic',
  baseUrl: DEFAULT_ORIGIN,
  pathPrefix: '/anthropic/v1',
  editable: false,
  auth: 'x-api-key',
  system: '该助手为DeepSeek，由深度求索公司创造。',
  models: [
    { id: 'deepseek-flash', label: 'DeepSeek Flash' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  ],
  defaultModel: 'deepseek-flash',
  maxTokens: 0,
  verifyPath: '/models',
  reasoningParam: 'output_config',
  features: {
    thinking: true,
    search: true,
    readLink: true,
    title: true,
    safetyCheck: true,
    latestReminder: true,
    files: true,
    speech: true,
  },
}

export const BUILTIN_PROVIDERS: Record<string, ProviderProfile> = { deepseek }

export const DEFAULT_PROVIDER_ID: ProviderId = 'deepseek'

export const isBuiltinProvider = (id: ProviderId): boolean =>
  Object.hasOwn(BUILTIN_PROVIDERS, id)

/** 内置供应商；未知 id 回退到默认供应商，不抛错 */
export const getBuiltinProvider = (id: ProviderId): ProviderProfile =>
  BUILTIN_PROVIDERS[id] ?? BUILTIN_PROVIDERS[DEFAULT_PROVIDER_ID]

/** 自定义服务的能力位：Chat Completions 没有搜索、引用、Files API 与标题扩展 */
const CUSTOM_FEATURES: ProviderFeatures = {
  // 是否真的下发 reasoning_effort 由模型名判断，见 api/openai.ts
  thinking: true,
  search: false,
  readLink: false,
  title: false,
  safetyCheck: false,
  latestReminder: false,
  files: false,
  speech: false,
}

/** 用户添加的服务合成为画像；地址为空时不做请求，由界面提示先填地址 */
export const createCustomProfile = (config: CustomProviderConfig): ProviderProfile => {
  const { id, name, baseUrl } = config
  const preset = getPreset(config.preset) ?? matchPresetByUrl(baseUrl)
  const models = preset?.models ?? []
  return {
    id,
    name,
    protocol: 'openai',
    baseUrl: baseUrl.replace(/\/+$/, ''),
    pathPrefix: '',
    editable: true,
    auth: 'bearer',
    system: null,
    // 预设自带兜底模型，拉取成功时以远端列表为准
    models,
    defaultModel: models[0]?.id ?? '',
    modelsPath: '/models',
    verifyPath: '/models',
    reasoningParam: 'reasoning_effort',
    // Chat Completions 必填；各家对上限接受度不同，取较通用的值
    maxTokens: 8192,
    features: CUSTOM_FEATURES,
  }
}

/** 自定义服务的展示名：没起名时用主机名，便于区分多条配置 */
export const getProviderLabel = (provider: ProviderProfile): string => {
  if (provider.name.trim()) {
    return provider.name.trim()
  }
  try {
    return new URL(provider.baseUrl).host
  } catch {
    return ''
  }
}

export const messagesUrl = (provider: ProviderProfile) =>
  `${provider.baseUrl}${provider.pathPrefix}/messages`

export const filesUrl = (provider: ProviderProfile) =>
  `${provider.baseUrl}${provider.pathPrefix}/files`

export const chatCompletionsUrl = (provider: ProviderProfile) =>
  `${provider.baseUrl}${provider.pathPrefix}/chat/completions`

/** 模型展示名；自定义模型直接显示 id */
export const getModelLabel = (provider: ProviderProfile, model: string) =>
  provider.models.find((item) => item.id === model)?.label ?? model

/**
 * 设置里提示给用户看的能力名（文案见 i18n）。
 * 语音不在其中：ASR / TTS 固定走 DeepSeek，与当前对话供应商无关。
 */
export type UserFacingFeature = 'search' | 'attachments'

/** 该供应商缺少的、界面上有入口的能力 */
export const getMissingFeatures = (provider: ProviderProfile): UserFacingFeature[] => {
  const missing: UserFacingFeature[] = []
  if (!provider.features.search) {
    missing.push('search')
  }
  if (!provider.features.files) {
    missing.push('attachments')
  }
  return missing
}

/** Files API 与语音接口目前只有 DeepSeek 兼容端点提供，固定使用该供应商的配置 */
export const FILES_PROVIDER = deepseek
