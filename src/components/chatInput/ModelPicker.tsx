import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { IconCheckOutline16, IconChevronDownOutline14 } from '../base/icons.js'
import { loadModels, useModels } from '../../services/api/models.js'
import {
  getModelLabel,
  getProviderLabel,
  type ProviderProfile,
} from '../../services/api/providers.js'
import { setModel, setProvider, useActiveProvider, useProviderList, useSettings } from '../../services/settings.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ModelPicker.module.css'

/**
 * 输入框旁的模型选择：按供应商分组列出模型，选中即切换供应商与模型；
 * 底部「管理服务」进入设置。自定义服务打开时会补拉一次模型列表。
 */
export const ModelPicker = () => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const provider = useActiveProvider()
  const providers = useProviderList()
  const model = useSettings((state) => state.model)
  const modelsState = useModels()
  // 自定义模型没有展示名，getModelLabel 会退回 id
  const currentLabel = model ? getModelLabel(provider, model) : ''
  const { anchorRef, floatingRef, position } = useAnchoredPosition<
    HTMLButtonElement,
    HTMLDivElement
  >(open, { side: 'top', align: 'end', maxHeight: 420, minSpace: 180 })
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false), { captureEscape: true })

  // 打开时补齐还没拉到的列表：自定义服务靠这一步，内置服务有兜底列表
  useEffect(() => {
    if (!open) {
      return
    }
    for (const item of providers) {
      if (item.editable && item.baseUrl && !modelsState[item.id]?.models.length) {
        void loadModels(item.id)
      }
    }
    // providers / modelsState 变化不重复触发，只在打开时补一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const groups = providers.map((item: ProviderProfile) => {
    const discovered = modelsState[item.id]?.models ?? []
    const models = discovered.length > 0 ? discovered : [...item.models]
    // 手填的模型或列表还没拉到时的当前值，补一条以便打勾
    if (item.id === provider.id && model && !models.some((entry) => entry.id === model)) {
      return { provider: item, models: [{ id: model, label: model }, ...models] }
    }
    return { provider: item, models }
  })

  const select = (targetProvider: ProviderProfile, targetModel: string) => {
    setOpen(false)
    if (targetProvider.id !== provider.id) {
      setProvider(targetProvider.id)
    }
    setModel(targetModel)
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={clsx(styles.trigger, open && styles.open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('modelPickerLabel')}
        title={getProviderLabel(provider) || t('providerUntitled')}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.provider}>{getProviderLabel(provider) || t('providerUntitled')}</span>
        <span className={styles.separator}>·</span>
        <span className={styles.label}>{currentLabel || t('modelPickerUnset')}</span>
        <span className={styles.arrow}>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.menu}
              style={position ?? undefined}
              role="menu"
              aria-label={t('modelPickerLabel')}
            >
              {groups.map(({ provider: item, models }) => (
                <div key={item.id} className={styles.group}>
                  <div className={styles.groupTitle}>
                    {getProviderLabel(item) || t('providerUntitled')}
                  </div>
                  {models.length === 0 ? (
                    <div className={styles.empty}>{t('modelPickerEmpty')}</div>
                  ) : (
                    models.map((entry) => {
                      const active = item.id === provider.id && entry.id === model
                      return (
                        <button
                          key={`${item.id}:${entry.id}`}
                          type="button"
                          role="menuitemradio"
                          aria-checked={active}
                          className={clsx(styles.item, active && styles.itemActive)}
                          onClick={() => select(item, entry.id)}
                        >
                          <span className={styles.itemLabel}>{entry.label}</span>
                          {active ? <IconCheckOutline16 /> : null}
                        </button>
                      )
                    })
                  )}
                </div>
              ))}
              <div className={styles.footer}>
                <button
                  type="button"
                  className={styles.footerButton}
                  onClick={() => {
                    setOpen(false)
                    openSettings('data')
                  }}
                >
                  {t('modelPickerManage')}
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
