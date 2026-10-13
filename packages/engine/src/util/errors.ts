import type { CommandError } from '@hydra/protocol'

/** Error carrying a stable code that maps directly onto a CommandAck. */
export class HydraError extends Error {
  constructor(
    readonly code: CommandError['code'],
    message: string
  ) {
    super(message)
    this.name = 'HydraError'
  }
}

export const invalid = (message: string) => new HydraError('invalid', message)
export const notFound = (what: string) => new HydraError('not_found', `${what} not found`)
export const conflict = (message: string) => new HydraError('conflict', message)
export const forbidden = (message: string) => new HydraError('forbidden', message)
export const unavailable = (message: string) => new HydraError('unavailable', message)

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BudgetExceededError'
  }
}

export class CanceledError extends Error {
  constructor(message = 'Canceled') {
    super(message)
    this.name = 'CanceledError'
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
