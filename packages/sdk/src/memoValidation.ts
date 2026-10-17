import { Memo } from '@stellar/stellar-sdk'
import type { SorobanResurrectConfig } from './types.js'
import type { WalletAdapter } from './types.js'
import { ResurrectError } from './errors.js'

/** Stellar protocol limit for `Memo.text`, measured in UTF-8 bytes. */
export const MAX_MEMO_TEXT_BYTES = 28

export function validateRestoreMemoText(
  value: unknown,
  field = 'restoreTxMemoText',
): asserts value is string {
  if (typeof value !== 'string') {
    throw new ResurrectError(
      'INVALID_RESTORE_MEMO',
      `Invalid config field "${field}": expected a string with a maximum of ${MAX_MEMO_TEXT_BYTES} UTF-8 bytes.`,
    )
  }

  const byteLength = new TextEncoder().encode(value).length
  if (byteLength > MAX_MEMO_TEXT_BYTES) {
    throw new ResurrectError(
      'INVALID_RESTORE_MEMO',
      `Invalid config field "${field}": memo is ${byteLength} UTF-8 bytes; the maximum is ${MAX_MEMO_TEXT_BYTES} bytes.`,
    )
  }
}

export function validateRestoreMemoConfig(
  config: Pick<SorobanResurrectConfig, 'restoreTxMemo' | 'restoreTxMemoText'>,
): void {
  if (config.restoreTxMemoText !== undefined) {
    validateRestoreMemoText(config.restoreTxMemoText)
  }

  const memo = config.restoreTxMemo
  if (memo === undefined) return
  if (!(memo instanceof Memo) || (memo.type !== 'text' && memo.type !== 'none')) {
    const type = memo instanceof Memo ? memo.type : typeof memo
    throw new ResurrectError(
      'INVALID_RESTORE_MEMO',
      `Invalid config field "restoreTxMemo": memo type "${type}" does not apply to restoreFootprint; use a text or none memo.`,
    )
  }

  if (memo.type === 'text') {
    validateRestoreMemoText(memo.value, 'restoreTxMemo')
  }
}

export function configForWalletRestore(
  config: SorobanResurrectConfig,
  wallet: WalletAdapter,
): SorobanResurrectConfig {
  if (
    wallet.capabilities?.hardware &&
    config.restoreTxMemo === undefined &&
    !config.restoreTxMemoText
  ) {
    return { ...config, restoreTxMemoText: 'Restore archived entries' }
  }
  return config
}
