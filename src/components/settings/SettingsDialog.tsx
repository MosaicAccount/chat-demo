import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconSettingsOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
} from '../../services/chat/backup.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore } from '../../services/chat/store.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import {
  addProvider,
  isChineseBrowser,
  removeProvider,
  setLocale,
  setLocation,
  setModel,
  setProvider,
  setThemePreference,
  setTtsVoice,
  setVisibleModels,
  updateProvider,
  useActiveProvider,
  useProviderList,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import {
  getMissingFeatures,
  getProviderLabel,
  PROVIDER_PRESETS,
  type UserFacingFeature,
} from '../../services/api/providers.js'
import {
  applyVisibility,
  forgetModels,
  loadModels,
  useModelOptions,
  useModelsError,
  useModelsStatus,
  type ModelsErrorKind,
} from '../../services/api/models.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { VisibleModelsDialog } from './VisibleModelsDialog.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）与「数据管理」（API Key、导入、导出、删除）。
 * 桌面端为居中弹窗、左侧导航；移动端为底部弹层、导航横排在内容上方
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
]

const SettingsContent = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  // 切换分组不丢失正在输入的 API Key 与导入状态
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory
  return (
    <>
      <Modal
        title={t('settings')}
        closable
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (!historyDelete.busy) {
            closeSettings()
          }
        }}
      >
        <div role="tablist" className={styles.navigation}>
          {sections.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={section === item.value}
              className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
              onClick={() => setSection(item.value)}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className={styles.content}>
          {section === 'general' ? (
            <>
              <ThemeSetting />
              <LocaleSetting />
              <TtsVoiceSetting />
              <LocationSetting />
            </>
          ) : (
            <>
              <ProviderSetting />
              <ModelSetting />
              <ApiKeyField editor={apiKeyEditor} />
              <ImportHistory historyImport={historyImport} disabled={historyBusy} />
              <ExportHistory disabled={historyBusy} />
              <SettingCell
                label={t('deleteAllSessions')}
                status={null}
                action={
                  <Button
                    variant="dangerOutlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={historyDelete.open}
                  >
                    {t('delete')}
                  </Button>
                }
              />
              {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
            </>
          )}
        </div>
      </Modal>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

/** 拉取模型列表失败时的提示：按原因给出可操作的说明 */
const MODEL_ERROR_KEYS: Record<ModelsErrorKind, TranslationKey> = {
  auth: 'modelListErrorAuth',
  notFound: 'modelListErrorNotFound',
  format: 'modelListErrorFormat',
  network: 'modelListErrorNetwork',
}

/** 「添加服务」里表示不带预设的选项值 */
const CUSTOM_PRESET = '__custom__'

/** 能力位在界面上的文案 */
const FEATURE_KEYS: Record<UserFacingFeature, TranslationKey> = {
  search: 'featureSearch',
  attachments: 'featureAttachments',
}

/**
 * 模型服务：内置 DeepSeek，其余由用户添加（OpenAI 兼容），可同时存在多条。
 * 每条服务各自保存名称、地址、Key 与模型。
 */
const ProviderSetting = () => {
  const t = useTranslate()
  const providerId = useSettings((state) => state.providerId)
  const provider = useActiveProvider()
  const providers = useProviderList()
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const reload = () => {
    window.clearTimeout(timer.current)
    void loadModels(provider.id, true)
  }

  /** 地址输入停顿 700ms 后按新地址重拉模型列表；还没成形为 URL 时不发请求 */
  const changeBaseUrl = (value: string) => {
    updateProvider(provider.id, { baseUrl: value })
    window.clearTimeout(timer.current)
    if (!/^https?:\/\/\S+$/i.test(value.trim())) {
      return
    }
    timer.current = window.setTimeout(reload, 700)
  }

  return (
    <div className={styles.cell}>
      <div className={styles.modelRow}>
        <div className={styles.text}>
          <div className={styles.label}>{t('settingsProvider')}</div>
        </div>
        <Select
          ariaLabel={t('settingsProvider')}
          className={styles.providerSelect}
          value={providerId}
          options={providers.map((item) => ({
            value: item.id,
            label: getProviderLabel(item) || t('providerUntitled'),
          }))}
          onChange={setProvider}
        />
        <Select
          ariaLabel={t('providerAdd')}
          value={CUSTOM_PRESET}
          placeholder={t('providerAdd')}
          options={[
            ...PROVIDER_PRESETS.map((preset) => ({ value: preset.id, label: preset.name })),
            { value: CUSTOM_PRESET, label: t('providerCustom') },
          ]}
          onChange={(value) => addProvider(value === CUSTOM_PRESET ? undefined : value)}
        />
      </div>
      {provider.editable ? (
        <div className={styles.providerFields}>
          <input
            className={styles.modelInput}
            aria-label={t('providerName')}
            placeholder={t('providerNamePlaceholder')}
            autoComplete="off"
            spellCheck={false}
            value={provider.name}
            onChange={(event) => updateProvider(provider.id, { name: event.target.value })}
          />
          <input
            className={styles.modelInput}
            aria-label={t('providerBaseUrl')}
            placeholder="https://api.example.com/v1"
            autoComplete="off"
            spellCheck={false}
            value={provider.baseUrl}
            onChange={(event) => changeBaseUrl(event.target.value)}
            onBlur={reload}
          />
          <button
            type="button"
            className={styles.providerRemove}
            onClick={() => {
              forgetModels(provider.id)
              removeProvider(provider.id)
            }}
          >
            {t('providerRemove')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** 选项值：选中它时改用下面的输入框填模型 id */
const CUSTOM_MODEL = '__custom__'

/** 模型：列表来自供应商的 models 接口，拉取失败时回落到内置列表；列表外的 id 可手填 */
const ModelSetting = () => {
  const t = useTranslate()
  const provider = useActiveProvider()
  const apiKey = useSettings((state) => state.apiKey)
  const model = useSettings((state) => state.model)
  const fullOptions = useModelOptions(provider)
  const visible = useSettings((state) => state.visibleModels[provider.id] ?? null)
  const options = applyVisibility(fullOptions, visible, model)
  const status = useModelsStatus(provider)
  const modelsError = useModelsError(provider)
  const [pickerOpen, setPickerOpen] = useState(false)
  const custom = !options.some((item) => item.id === model)
  const missing = getMissingFeatures(provider)

  // 换供应商或换 Key 后重新拉取；有缓存时先用缓存，过期才真正请求
  useEffect(() => {
    void loadModels(provider.id)
  }, [provider.id, apiKey])

  return (
    <div className={styles.cell}>
      <div className={styles.modelRow}>
        <div className={styles.text}>
          <div className={styles.label}>{t('settingsModel')}</div>
          {missing.length > 0 ? (
            <div className={styles.description}>
              {t('providerUnsupportedFeatures', {
                features: missing.map((item) => t(FEATURE_KEYS[item])).join(t('listSeparator')),
              })}
            </div>
          ) : null}
          {/* 预设自带兜底模型时（该服务本身没有 models 接口）不打扰用户 */}
          {status === 'error' && provider.models.length === 0 ? (
            <div className={styles.description}>
              {t(modelsError ? MODEL_ERROR_KEYS[modelsError] : 'modelListFallback')}
            </div>
          ) : null}
        </div>
        <Select
          ariaLabel={t('settingsModel')}
          className={styles.modelSelect}
          value={custom ? CUSTOM_MODEL : model}
          options={[
            ...options.map((item) => ({ value: item.id, label: item.label })),
            { value: CUSTOM_MODEL, label: t('modelCustom') },
          ]}
          onChange={(value) => setModel(value === CUSTOM_MODEL ? '' : value)}
        />
      </div>
      {/* 模型多到用不过来时，勾选只保留常用的几个 */}
      {fullOptions.length > 5 ? (
        <button
          type="button"
          className={styles.modelVisibility}
          onClick={() => setPickerOpen(true)}
        >
          {t('visibleModelsButton')}
          {visible ? ` · ${visible.length}/${fullOptions.length}` : ''}
        </button>
      ) : null}
      {pickerOpen ? (
        <VisibleModelsDialog
          title={t('visibleModelsTitle', {
            name: getProviderLabel(provider) || t('providerUntitled'),
          })}
          models={fullOptions}
          selected={visible}
          onCancel={() => setPickerOpen(false)}
          onSave={(ids) => {
            // 全部勾选等价于不限制，之后新上架的模型也能自动出现
            setVisibleModels(provider.id, ids.length === fullOptions.length ? null : ids)
            setPickerOpen(false)
          }}
        />
      ) : null}
      {custom ? (
        <input
          className={styles.modelInput}
          aria-label={t('modelCustom')}
          placeholder={t('modelCustomPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          value={model}
          onChange={(event) => setModel(event.target.value)}
        />
      ) : null}
    </div>
  )
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <SettingCell
      label={t('settingsLocation')}
      status={null}
      className={styles.locationCell}
      action={
        <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                placeholder={t('settingsLocationProvince')}
                options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                onChange={(value) => {
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                placeholder={t('settingsLocationCity')}
                options={
                  province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                }
                onChange={(value) => {
                  if (province) {
                    setLocation({ region: 'CN', province: province.code, city: value })
                  }
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              placeholder={t('settingsLocationRegion')}
              options={regionCodes
                .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))}
              onChange={(value) => setLocation({ region: value })}
            />
          )}
        </div>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

/** 覆盖导入的二次确认，叠在设置弹窗上 */
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button variant="dangerOutlined" size="m" onClick={() => void historyImport.confirm()}>
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

const SettingCell = ({
  label,
  description,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，任何错误都提示导入失败。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setBusy(true)
    setStatus(null)
    try {
      const count = await importHistory(file)
      setStatus({ key: count === 1 ? 'historyImportedOne' : 'historyImported', params: { count } })
    } catch {
      setStatus({ key: 'historyImportFailed', error: true })
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  return { file, busy, status, select: setFile, cancel: () => setFile(null), confirm }
}

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                historyImport.select(file)
              }
            }}
          />
        </>
      }
    />
  )
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportHistory()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}
