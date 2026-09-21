import type { BrainErrorCode, Result } from '@g-brain/core'

/**
 * The single mapping point, the web analogue of the CLI's exit codes. A switch
 * on the typed code and nothing else: the code is the truth and the status is
 * only how HTTP says it, so no core function ever returns a status.
 */
export function statusFor(code: BrainErrorCode): number {
  switch (code) {
    case 'UNAUTHORIZED':
      return 401
    case 'FORBIDDEN':
      return 403
    case 'NOT_FOUND':
      return 404
    case 'INVALID_PATH':
      return 400
    case 'RATE_LIMITED':
      return 429
    default:
      return 500
  }
}

export function toHttpResponse<T>(result: Result<T>): {
  status: number
  code?: BrainErrorCode
  body: T | { code: BrainErrorCode; message: string }
} {
  if (result.ok) return { status: 200, body: result.value }

  return {
    status: statusFor(result.error.code),
    code: result.error.code,
    body: { code: result.error.code, message: result.error.message },
  }
}
