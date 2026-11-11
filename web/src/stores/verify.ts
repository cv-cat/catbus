import { defineStore } from 'pinia'
import { reactive } from 'vue'

/** 只接受 https 链接，别的一律当成没有链接 */
export const safeVerifyUrl = (v: unknown): string | null =>
  typeof v === 'string' && /^https:\/\/\S+$/.test(v) ? v : null

/** 从 catbus 的错误里取验证链接：只有 RISK_CONTROL 才有 */
export function verifyUrlOf(error: { code?: string; detail?: unknown } | null | undefined): string | null {
  if (error?.code !== 'RISK_CONTROL') return null
  return safeVerifyUrl((error.detail as { verify_url?: unknown } | null)?.verify_url)
}

export interface VerifyRequest {
  platform: string
  url: string | null
  message?: string
  retry?: () => unknown
}

/** 人机验证弹窗的全局状态：任何地方都可以 openVerify(平台, 验证链接, 验证完重试) */
export const useVerifyStore = defineStore('verify', () => {
  const verify = reactive({
    open: false,
    platform: '',
    url: null as string | null,
    message: '',
    retry: null as null | (() => unknown),
  })

  function open(o: VerifyRequest) {
    Object.assign(verify, { open: true, platform: o.platform, url: safeVerifyUrl(o.url), message: o.message ?? '', retry: o.retry ?? null })
  }

  return { verify, open, close: () => (verify.open = false) }
})

export const openVerify = (o: VerifyRequest) => useVerifyStore().open(o)
