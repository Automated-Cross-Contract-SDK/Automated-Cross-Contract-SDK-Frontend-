import { Memo } from '@stellar/stellar-sdk'
import type { SorobanResurrectConfig } from './types.js'
import { ResurrectError } from './errors.js'

/**
 * Rejects restore memos. The Stellar network refuses any Soroban transaction
 * that carries a memo, so a configured memo would make every restore fail
 * after the user has already signed it.
 */
export function validateRestoreMemoConfig(
  config: Pick<SorobanResurrectConfig, 'restoreTxMemo' | 'restoreTxMemoText'>,
): void {
  const { restoreTxMemo: memo, restoreTxMemoText: text } = config
  const field =
    memo !== undefined && !(memo instanceof Memo && memo.type === 'none')
      ? 'restoreTxMemo'
      : text !== undefined && text !== ''
        ? 'restoreTxMemoText'
        : undefined
  if (field) {
    throw new ResurrectError(
      'INVALID_RESTORE_MEMO',
      `Invalid config field "${field}": Soroban transactions cannot carry a memo. Remove this option.`,
    )
  }
}
