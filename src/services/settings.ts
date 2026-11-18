import { create } from 'zustand'
import {
  BUILTIN_PROVIDERS,
  createCustomProfile,
  DEFAULT_PROVIDER_ID,
  getBuiltinProvider,
  getPreset,
  isBuiltinProvider,
  matchPresetByUrl,
  type CustomProviderConfig,
  type ProviderId,
  type ProviderProfile,
} from './api/providers.js'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 单个供应商的本机配置：Key 与所选模型各自独立 */
export type ProviderSetting = {
  apiKey: string | null
  model: string
}

/**
 * 本机设置，存 localStorage：当前供应商、用户添加的服务列表、各服务的 Key 与模型、
 * 语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态
 */
type Settings = {
  providerId: ProviderId
  /** 用户添加的 OpenAI 兼容服务，顺序即下拉里的顺序 */
  customProviders: CustomProviderConfig[]
  /** 按供应商 id 存 Key 与模型；自定义服务被删除后对应条目会一起移除 */
  providers: Record<ProviderId, ProviderSetting>
  /**
   * 用户勾选的可见模型；未设置表示全部可见。
   * 供应商动辄给出上百个模型，这里只影响选择器里列什么，不影响能否手填。
   */
  visibleModels: Record<ProviderId, string[] | null>
  /** 派生字段：当前供应商的 Key，请求与既有调用点直接读取，避免到处查表 */
  apiKey: string | null
  /** 派生字段：当前供应商的模型 */
  model: string
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  /** 旧版单 Key，只用于迁移 */
  legacyApiKey: 'chat-demo:api-key',
  providerId: 'chat-demo:provider',
  customProviders: 'chat-demo:custom-providers',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

/** 各供应商的 Key 与模型分开存，切换供应商不互相覆盖 */
const providerApiKeyKey = (id: ProviderId) => `chat-demo:api-key:${id}`
const providerModelKey = (id: ProviderId) => `chat-demo:model:${id}`
const providerVisibleKey = (id: ProviderId) => `chat-demo:visible-models:${id}`

const EMPTY_SETTING: ProviderSetting = { apiKey: null, model: '' }

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

const isCustomConfig = (value: unknown): value is CustomProviderConfig =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as CustomProviderConfig).id === 'string' &&
  typeof (value as CustomProviderConfig).name === 'string' &&
  typeof (value as CustomProviderConfig).baseUrl === 'string' &&
  ((value as CustomProviderConfig).preset === undefined ||
    typeof (value as CustomProviderConfig).preset === 'string')

/**
 * 用户添加的服务列表。
 * 旧版只有一个固定的 openai 槽位，升级时把它的地址与 Key 迁移成一条自定义服务。
 */
const initialCustomProviders = (): CustomProviderConfig[] => {
  try {
    const saved: unknown = JSON.parse(read(KEYS.customProviders) ?? 'null')
    if (Array.isArray(saved)) {
      return saved
        .filter(isCustomConfig)
        .filter((item) => !isBuiltinProvider(item.id))
        // 预设下线后（如已移除的服务）清掉悬空 id，避免继续引用不存在的兜底模型
        .map((item) => (item.preset && getPreset(item.preset) ? item : { ...item, preset: undefined }))
    }
  } catch {
    // 解析失败按空列表处理，下面尝试旧版迁移
  }
  const legacyBaseUrl = read('chat-demo:base-url:openai')
  const legacyKey = read('chat-demo:api-key:openai')
  const legacyModel = read('chat-demo:model:openai')
  if (legacyBaseUrl || legacyKey || legacyModel) {
    const baseUrl = legacyBaseUrl?.trim() || 'https://api.openai.com/v1'
    const migrated = [
      {
        id: 'openai',
        name: '',
        baseUrl,
        preset: matchPresetByUrl(baseUrl)?.id,
      },
    ]
    // 迁移结果落盘，之后即使清理了其他键也不会重复迁移
    write(KEYS.customProviders, JSON.stringify(migrated))
    return migrated
  }
  return []
}

/** 按 id 读 Key 与模型；没有记录时用画像的默认模型（自定义服务取预设的第一个模型） */
const initialSetting = (
  id: ProviderId,
  legacyApiKey: string | null,
  fallbackModel: string
): ProviderSetting => {
  const savedKey = read(providerApiKeyKey(id))
  const apiKey = savedKey ?? (id === DEFAULT_PROVIDER_ID ? legacyApiKey : null)
  if (!savedKey && apiKey) {
    write(providerApiKeyKey(id), apiKey)
  }
  return { apiKey, model: read(providerModelKey(id)) ?? fallbackModel }
}

const initialProviders = (customProviders: CustomProviderConfig[]): Record<ProviderId, ProviderSetting> => {
  const legacyApiKey = read(KEYS.legacyApiKey)
  const providers: Record<ProviderId, ProviderSetting> = {}
  for (const profile of [
    ...Object.values(BUILTIN_PROVIDERS),
    ...customProviders.map(createCustomProfile),
  ]) {
    providers[profile.id] = initialSetting(profile.id, legacyApiKey, profile.defaultModel)
  }
  // 旧版只保存了一个 Key，迁移后删除，避免重复读取
  if (legacyApiKey) {
    write(KEYS.legacyApiKey, null)
  }
  return providers
}

/** 读取某个服务的可见模型；没有记录或内容无效时为 null，表示全部可见 */
const readVisibleModels = (id: ProviderId): string[] | null => {
  try {
    const parsed: unknown = JSON.parse(read(providerVisibleKey(id)) ?? 'null')
    return Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((item) => typeof item === 'string')
      ? parsed
      : null
  } catch {
    return null
  }
}

const initialVisibleModels = (
  customProviders: CustomProviderConfig[]
): Record<ProviderId, string[] | null> => {
  const visible: Record<ProviderId, string[] | null> = {}
  for (const id of [...Object.keys(BUILTIN_PROVIDERS), ...customProviders.map((item) => item.id)]) {
    visible[id] = readVisibleModels(id)
  }
  return visible
}

const initialCustom = initialCustomProviders()
const initialProviderSettings = initialProviders(initialCustom)

/** 未保存过、或指向已删除的服务时回到默认供应商 */
const initialProviderId = (): ProviderId => {
  const saved = read(KEYS.providerId)
  if (saved && (isBuiltinProvider(saved) || initialCustom.some((item) => item.id === saved))) {
    return saved
  }
  return DEFAULT_PROVIDER_ID
}

const initialProviderIdValue = initialProviderId()

const settingFor = (
  providers: Record<ProviderId, ProviderSetting>,
  id: ProviderId
): ProviderSetting => providers[id] ?? EMPTY_SETTING

const persistCustomProviders = (customProviders: CustomProviderConfig[]) => {
  write(KEYS.customProviders, JSON.stringify(customProviders))
}

/** 内置供应商直接用画像，自定义服务由配置合成 */
const profileOf = (id: ProviderId, customProviders: CustomProviderConfig[]): ProviderProfile => {
  if (isBuiltinProvider(id)) {
    return getBuiltinProvider(id)
  }
  const config = customProviders.find((item) => item.id === id)
  return config ? createCustomProfile(config) : getBuiltinProvider(DEFAULT_PROVIDER_ID)
}

export const useSettings = create<Settings>(() => ({
  providerId: initialProviderIdValue,
  customProviders: initialCustom,
  providers: initialProviderSettings,
  visibleModels: initialVisibleModels(initialCustom),
  apiKey: settingFor(initialProviderSettings, initialProviderIdValue).apiKey,
  model: settingFor(initialProviderSettings, initialProviderIdValue).model,
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  const { providerId, providers } = useSettings.getState()
  write(providerApiKeyKey(providerId), apiKey)
  useSettings.setState({
    providers: { ...providers, [providerId]: { ...settingFor(providers, providerId), apiKey } },
    apiKey,
  })
}

/** 切换供应商：Key 与模型跟随切到该供应商自己的配置 */
export const setProvider = (providerId: ProviderId) => {
  write(KEYS.providerId, providerId)
  const setting = settingFor(useSettings.getState().providers, providerId)
  useSettings.setState({ providerId, apiKey: setting.apiKey, model: setting.model })
}

/** 模型按供应商分别保存，允许填列表之外的 id */
export const setModel = (model: string) => {
  const { providerId, providers } = useSettings.getState()
  write(providerModelKey(providerId), model)
  useSettings.setState({
    providers: { ...providers, [providerId]: { ...settingFor(providers, providerId), model } },
    model,
  })
}

/**
 * 新建一条 OpenAI 兼容服务并立即选中。
 * 传预设 id 时用预设的名称、地址与兜底模型；不传则留空由用户填。
 */
export const addProvider = (presetId?: string): ProviderId => {
  const { customProviders } = useSettings.getState()
  const preset = getPreset(presetId)
  const id = `custom-${Date.now().toString(36)}`
  const config: CustomProviderConfig = preset
    ? { id, name: preset.name, baseUrl: preset.baseUrl, preset: preset.id }
    : { id, name: '', baseUrl: '' }
  const next = [...customProviders, config]
  persistCustomProviders(next)
  // 同时建一条 Key/模型记录，后续读写不必到处判空；预设自带模型时先放上第一个
  useSettings.setState((state) => ({
    customProviders: next,
    providers: {
      ...state.providers,
      [id]: { apiKey: null, model: preset?.models[0]?.id ?? '' },
    },
  }))
  setProvider(id)
  return id
}

/** 改名或改地址；换地址后手选的模型不再适用，清掉标记让新列表决定默认值 */
export const updateProvider = (
  id: ProviderId,
  patch: Partial<Omit<CustomProviderConfig, 'id'>>
) => {
  const { customProviders } = useSettings.getState()
  const previous = customProviders.find((item) => item.id === id)
  if (!previous) {
    return
  }
  const next = customProviders.map((item) => (item.id === id ? { ...item, ...patch } : item))
  persistCustomProviders(next)
  if (patch.baseUrl !== undefined && patch.baseUrl.trim() !== previous.baseUrl.trim()) {
    write(providerModelKey(id), null)
  }
  useSettings.setState({ customProviders: next })
}

/** 删除服务：连带清掉它的 Key、模型与选中状态 */
export const removeProvider = (id: ProviderId) => {
  const { customProviders, providers, providerId } = useSettings.getState()
  if (isBuiltinProvider(id)) {
    return
  }
  const next = customProviders.filter((item) => item.id !== id)
  persistCustomProviders(next)
  write(providerApiKeyKey(id), null)
  write(providerModelKey(id), null)
  write(providerVisibleKey(id), null)
  const rest = Object.fromEntries(Object.entries(providers).filter(([key]) => key !== id))
  const { visibleModels } = useSettings.getState()
  const visibleRest = Object.fromEntries(
    Object.entries(visibleModels).filter(([key]) => key !== id)
  )
  useSettings.setState({ customProviders: next, providers: rest, visibleModels: visibleRest })
  if (providerId === id) {
    setProvider(DEFAULT_PROVIDER_ID)
  }
}

/** 勾选可见模型；传 null 或空数组表示全部可见，避免出现「一个都不显示」的死角 */
export const setVisibleModels = (providerId: ProviderId, ids: string[] | null) => {
  const { visibleModels } = useSettings.getState()
  const value = ids && ids.length > 0 ? [...new Set(ids)] : null
  write(providerVisibleKey(providerId), value ? JSON.stringify(value) : null)
  useSettings.setState({ visibleModels: { ...visibleModels, [providerId]: value } })
}

/** 合并后的当前供应商画像 */
export const resolveProvider = (providerId: ProviderId): ProviderProfile =>
  profileOf(providerId, useSettings.getState().customProviders)

/** 下拉用的完整列表：内置在前，自定义按添加顺序 */
export const listProviders = (): ProviderProfile[] => {
  const { customProviders } = useSettings.getState()
  return [
    getBuiltinProvider(DEFAULT_PROVIDER_ID),
    ...customProviders.map(createCustomProfile),
  ]
}

/** 用户是否手动选过模型；未选过时允许用远端列表的默认值替换内置默认值 */
export const hasExplicitModel = (providerId: ProviderId) =>
  read(providerModelKey(providerId)) !== null

/** 远端列表带来的默认模型：只改内存，不写存储，保持「未手动选择」的状态 */
export const applyDiscoveredModel = (providerId: ProviderId, model: string) => {
  const { providerId: activeId, providers } = useSettings.getState()
  const base = (providers[providerId] ?? EMPTY_SETTING).model
  if (base === model) {
    return
  }
  useSettings.setState({
    providers: { ...providers, [providerId]: { ...settingFor(providers, providerId), model } },
    ...(activeId === providerId ? { model } : {}),
  })
}

/** 当前供应商的画像：地址、鉴权方式与能力位，见 api/providers.ts */
export const getActiveProvider = (): ProviderProfile =>
  resolveProvider(useSettings.getState().providerId)

/** 组件内订阅当前供应商；列表变化时要跟着重渲染 */
export const useActiveProvider = (): ProviderProfile => {
  const providerId = useSettings((state) => state.providerId)
  const customProviders = useSettings((state) => state.customProviders)
  return profileOf(providerId, customProviders)
}

/** 组件内订阅可选供应商列表 */
export const useProviderList = (): ProviderProfile[] => {
  const customProviders = useSettings((state) => state.customProviders)
  return [
    getBuiltinProvider(DEFAULT_PROVIDER_ID),
    ...customProviders.map(createCustomProfile),
  ]
}

/**
 * 模型属于哪个内置供应商；自定义服务的模型在远端列表里，这里返回 null。
 * 用于判断历史消息里的模型能否在当前供应商继续使用。
 */
export const findModelProvider = (model: string): ProviderProfile | null =>
  Object.values(BUILTIN_PROVIDERS).find((provider) =>
    provider.models.some((item) => item.id === model)
  ) ?? null

/**
 * Files API 与 ASR / TTS 只有 DeepSeek 兼容端点提供，
 * 即使当前选中其他供应商，这两类请求也固定使用 DeepSeek 的 Key；未配置时为 null。
 */
export const getDeepseekApiKey = (): string | null =>
  useSettings.getState().providers.deepseek?.apiKey ?? null

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
