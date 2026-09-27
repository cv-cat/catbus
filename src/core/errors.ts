export type ErrorCode =
  | 'ERROR'
  | 'USAGE'
  | 'UNSUPPORTED'
  | 'CONFIRM_REQUIRED'
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'NOT_IMPLEMENTED'
  | 'RISK_CONTROL'
  | 'NETWORK'
  | 'UPSTREAM'

/** 退出码（AGENTS 6.4）。 */
export const EXIT_CODES: Record<ErrorCode, number> = {
  ERROR: 1,
  USAGE: 2,
  UNSUPPORTED: 2,
  CONFIRM_REQUIRED: 2,
  AUTH_REQUIRED: 3,
  AUTH_EXPIRED: 3,
  NOT_IMPLEMENTED: 4,
  RISK_CONTROL: 5,
  NETWORK: 6,
  UPSTREAM: 7,
}

export interface ErrorOptions {
  hint?: string | null
  detail?: unknown
  cause?: unknown
}

export class CatbusError extends Error {
  readonly code: ErrorCode
  readonly hint: string | null
  readonly detail: unknown

  constructor(code: ErrorCode, message: string, options: ErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'CatbusError'
    this.code = code
    this.hint = options.hint ?? null
    this.detail = options.detail ?? null
  }

  get exitCode(): number {
    return EXIT_CODES[this.code]
  }

  toJSON() {
    return { code: this.code, message: this.message, hint: this.hint, detail: this.detail }
  }
}

export function toCatbusError(err: unknown): CatbusError {
  if (err instanceof CatbusError) return err
  const message = err instanceof Error ? err.message : String(err)
  return new CatbusError('ERROR', message, { cause: err })
}
