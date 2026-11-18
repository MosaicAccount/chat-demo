import { useState } from 'react'
import { ApiError, verifyApiKey } from '../../services/api/client.js'
import { loadModels } from '../../services/api/models.js'
import { classifyApiError } from '../../services/api/errors.js'
import { setApiKey, useActiveProvider } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'

/** 输入 API Key 后先校验（GET /models 或最小请求），通过才保存到当前供应商 */
export const useApiKeyForm = (onSaved?: () => void) => {
  const t = useTranslate()
  const provider = useActiveProvider()
  const [value, setValue] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null)
  const cause = failure?.cause
  const error =
    failure === null
      ? null
      : classifyApiError(cause) === 'unauthorized'
        ? t('apiKeyInvalid')
        : classifyApiError(cause) === 'network'
          ? t('commonNetworkErrorToast')
          : t('apiKeyVerificationFailed', {
              message:
                cause instanceof ApiError && cause.localMessage
                  ? t(cause.localMessage.key, cause.localMessage.params)
                  : cause instanceof Error
                    ? cause.message
                    : String(cause),
            })

  const submit = async () => {
    const apiKey = value.trim()
    if (!apiKey || verifying) {
      return
    }
    setVerifying(true)
    setFailure(null)
    try {
      await verifyApiKey(provider, apiKey)
      setApiKey(apiKey)
      // 新 Key 可能带出不同的模型授权，强制刷新列表
      void loadModels(provider.id, true)
      setValue('')
      onSaved?.()
    } catch (e) {
      setFailure({ cause: e })
    } finally {
      setVerifying(false)
    }
  }

  return { value, setValue, verifying, error, submit }
}
