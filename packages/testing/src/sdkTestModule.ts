export class WalletError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly originalError?: unknown,
  ) {
    super(message)
    this.name = 'WalletError'
  }
}

export const asStellarPublicKey = (value: string): string => value
export const asXdrBase64 = (value: string): string => value
