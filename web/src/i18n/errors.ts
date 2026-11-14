import type { CatbusError } from '@/api/types'
import { currentLocale, SOURCE_LOCALE, t } from '.'

/**
 * CLI 信封里的错误：message / hint 是 CLI 生成的中文（AGENTS.md 7.9「多语言」）。
 * 中文界面直接显示原文（最具体）；其他语言按 code 显示译文，原文放到详情里。
 */

const KNOWN = new Set([
  'ERROR',
  'USAGE',
  'UNSUPPORTED',
  'CONFIRM_REQUIRED',
  'AUTH_REQUIRED',
  'AUTH_EXPIRED',
  'NOT_IMPLEMENTED',
  'RISK_CONTROL',
  'NETWORK',
  'UPSTREAM',
  'BRIDGE',
])

const native = () => currentLocale() === SOURCE_LOCALE

/** 错误的标题：中文界面用原文，其他语言用 errors.code.<CODE> 的译文 */
export function errorTitle(e: Pick<CatbusError, 'code' | 'message'> | null | undefined): string {
  if (!e) return t('errors.code.ERROR')
  if (native() && e.message) return e.message
  return t(`errors.code.${KNOWN.has(e.code) ? e.code : 'ERROR'}`)
}

/** 错误的详情：非中文界面时是 CLI 的原文（和 hint），中文界面只给 hint；没有时为 null */
export function errorDetail(e: Pick<CatbusError, 'message' | 'hint'> | null | undefined): string | null {
  if (!e) return null
  const parts = native() ? [e.hint] : [e.message, e.hint]
  return parts.filter(Boolean).join('\n') || null
}
