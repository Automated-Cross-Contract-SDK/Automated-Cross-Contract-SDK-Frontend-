import type { WalletAdapter, WalletCapabilities } from './types.js'

/**
 * Feature-detection helpers for {@link WalletAdapter.capabilities}.
 *
 * The rules are deliberately lenient: a capability is only treated as
 * unsupported when the adapter *explicitly* sets the flag to `false`. A missing
 * flag (or a missing `capabilities` object) means "unknown", in which case the
 * SDK keeps its previous best-effort behaviour of attempting the operation.
 */

/** Boolean capability keys (everything on {@link WalletCapabilities} except `maxOperations`). */
export type BooleanWalletCapability = {
  [K in keyof WalletCapabilities]-?: WalletCapabilities[K] extends boolean | undefined ? K : never
}[keyof WalletCapabilities]

/**
 * Returns `true` unless the wallet explicitly declares `capabilities[flag] === false`.
 * Unknown (flag or `capabilities` absent) is treated as "might work".
 */
export function walletMaySupport(
  wallet: Pick<WalletAdapter, 'capabilities'>,
  flag: BooleanWalletCapability,
): boolean {
  return wallet.capabilities?.[flag] !== false
}

/**
 * Returns `true` only when the wallet explicitly declares `capabilities[flag] === true`.
 * Unknown is treated as "not advertised".
 */
export function walletDeclares(
  wallet: Pick<WalletAdapter, 'capabilities'>,
  flag: BooleanWalletCapability,
): boolean {
  return wallet.capabilities?.[flag] === true
}

/**
 * Throws a descriptive error when the wallet has explicitly opted out of a
 * capability the SDK is about to rely on. No-op when the capability is
 * supported or unknown.
 */
export function assertWalletCapability(
  wallet: Pick<WalletAdapter, 'capabilities'>,
  flag: BooleanWalletCapability,
  context: string,
): void {
  if (wallet.capabilities?.[flag] === false) {
    throw new Error(
      `${context}: the connected wallet declares it does not support "${flag}" ` +
        `(capabilities.${flag} === false). Use a wallet that supports this feature ` +
        `or remove the code path that requires it.`,
    )
  }
}

/**
 * Returns the wallet's declared per-transaction operation limit, or `undefined`
 * when the wallet does not advertise one.
 */
export function walletMaxOperations(
  wallet: Pick<WalletAdapter, 'capabilities'>,
): number | undefined {
  return wallet.capabilities?.maxOperations
}
