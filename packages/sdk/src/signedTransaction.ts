import {
  FeeBumpTransaction,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import type { WalletAdapter } from './types.js'
import type { SorobanResurrectConfig } from './types.js'
import { ResurrectError } from './errors.js'
import { asXdrBase64 } from './branded-types.js'

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

function sameOperations(expected: Transaction, actual: Transaction): boolean {
  const expectedOperations = expected.toEnvelope().v1().tx().operations()
  const actualOperations = actual.toEnvelope().v1().tx().operations()
  return (
    expectedOperations.length === actualOperations.length &&
    expectedOperations.every(
      (operation, index) =>
        operation.toXDR('base64') === actualOperations[index].toXDR('base64'),
    )
  )
}

/**
 * Parses and verifies a wallet response against the unsigned transaction.
 * Signatures do not change the transaction hash, so it also verifies the
 * passphrase and all other transaction fields.
 */
export function verifySignedTransaction(
  unsignedTx: Transaction,
  signedXdr: string,
  networkPassphrase: string,
): Transaction {
  let signedTx
  try {
    signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase)
  } catch (error) {
    throw new ResurrectError(
      'SIGNED_TRANSACTION_MISMATCH',
      `Wallet returned an invalid signed transaction: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (signedTx instanceof FeeBumpTransaction) {
    throw new ResurrectError(
      'UNEXPECTED_FEE_BUMP_ENVELOPE',
      'Wallet returned a fee-bump envelope when the SDK requested a plain transaction.',
    )
  }
  if (!(signedTx instanceof Transaction)) {
    throw new ResurrectError(
      'SIGNED_TRANSACTION_MISMATCH',
      'Wallet returned an unsupported transaction envelope.',
    )
  }

  if (
    signedTx.source !== unsignedTx.source ||
    !sameOperations(unsignedTx, signedTx) ||
    !sameBytes(unsignedTx.hash(), signedTx.hash())
  ) {
    throw new ResurrectError(
      'SIGNED_TRANSACTION_MISMATCH',
      'Wallet returned a signed transaction that differs from the requested source, operations, or network transaction.',
    )
  }

  return signedTx
}

/** Warns and signs only transactions whose returned envelope verifies. */
export async function signAndVerifyTransaction(
  transaction: Transaction,
  wallet: WalletAdapter,
  networkPassphrase: string,
  config: Pick<SorobanResurrectConfig, 'logger'>,
): Promise<Transaction> {
  if (wallet.capabilities?.hardware) {
    config.logger?.warn(
      'Hardware wallet signing: transaction details may not be fully verifiable on the device.',
      { wallet: 'hardware' },
    )
  }

  const signedXdr = await wallet.signTransaction(asXdrBase64(transaction.toXDR()), {
    networkPassphrase,
  })
  return verifySignedTransaction(transaction, signedXdr, networkPassphrase)
}
