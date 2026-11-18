import { useMemo, useState } from 'react'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { useTranslate } from '../../i18n/index.js'
import type { ModelOption } from '../../services/api/providers.js'
import styles from './VisibleModelsDialog.module.css'

/**
 * 可见模型勾选：供应商动辄给出上百个模型，这里只决定选择器里列哪些。
 * 全部勾选时保存为「不限制」，之后新上架的模型也能自动出现；
 * 一个都不勾选会导致选择器为空，因此禁止保存空集合。
 */
export const VisibleModelsDialog = ({
  title,
  models,
  selected,
  onCancel,
  onSave,
}: {
  title: string
  models: ModelOption[]
  /** null 表示当前不限制 */
  selected: string[] | null
  onCancel: () => void
  onSave: (ids: string[]) => void
}) => {
  const t = useTranslate()
  const allIds = useMemo(() => models.map((item) => item.id), [models])
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selected ?? allIds))
  const [keyword, setKeyword] = useState('')

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    if (!query) {
      return models
    }
    return models.filter(
      (item) =>
        item.id.toLowerCase().includes(query) || item.label.toLowerCase().includes(query)
    )
  }, [keyword, models])

  const toggle = (id: string) => {
    setDraft((previous) => {
      const next = new Set(previous)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <Modal
      title={title}
      closable
      className={styles.dialog}
      mainClassName={styles.main}
      onClose={onCancel}
      footer={
        <div className={styles.footer}>
          <span className={styles.count}>
            {t('visibleModelsCount', { shown: draft.size, total: models.length })}
          </span>
          <div className={styles.footerActions}>
            <Button variant="outlined" size="m" onClick={onCancel}>
              {t('cancel')}
            </Button>
            <Button
              size="m"
              disabled={draft.size === 0}
              onClick={() => onSave([...draft])}
            >
              {t('confirm')}
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.toolbar}>
        <input
          className={styles.search}
          aria-label={t('visibleModelsSearch')}
          placeholder={t('visibleModelsSearch')}
          autoComplete="off"
          spellCheck={false}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <button
          type="button"
          className={styles.action}
          onClick={() => setDraft(new Set(allIds))}
        >
          {t('visibleModelsAll')}
        </button>
        <button type="button" className={styles.action} onClick={() => setDraft(new Set())}>
          {t('visibleModelsNone')}
        </button>
      </div>
      <div className={styles.list}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>{t('visibleModelsNoMatch')}</div>
        ) : (
          filtered.map((item) => (
            <label key={item.id} className={styles.row}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={draft.has(item.id)}
                onChange={() => toggle(item.id)}
              />
              <span className={styles.name}>{item.label}</span>
              {item.label === item.id ? null : <span className={styles.id}>{item.id}</span>}
            </label>
          ))
        )}
      </div>
    </Modal>
  )
}
