import { describe, expect, it, vi } from 'vitest'
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { ResurrectError } from '../errors.js'
import { signAndVerifyTransaction, verifySignedTransaction } from '../signedTransaction.js'
import type { WalletAdapter } from '../types.js'

function buildTransaction(source = Keypair.random()): {
  transaction: Transaction
  source: Keypair
} {
  const transaction = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(30)
    .build()
  return { transaction, source }
}

describe('verifySignedTransaction', () => {
  it('accepts a legitimate signature without changing the transaction', () => {
    const { transaction, source } = buildTransaction()
    const signed = TransactionBuilder.fromXDR(
      transaction.toXDR(),
      Networks.TESTNET,
    ) as Transaction
    signed.sign(source)

    expect(
      verifySignedTransaction(transaction, signed.toXDR(), Networks.TESTNET),
    ).toBeInstanceOf(Transaction)
  })

  it('rejects fee-bump envelopes with a dedicated typed error', () => {
    const { transaction } = buildTransaction()
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      Keypair.random().publicKey(),
      '1000',
      transaction,
      Networks.TESTNET,
    )

    expect(() =>
      verifySignedTransaction(transaction, feeBump.toXDR(), Networks.TESTNET),
    ).toThrowError(
      expect.objectContaining({
        code: 'UNEXPECTED_FEE_BUMP_ENVELOPE',
      }),
    )
  })

  it('rejects a wallet response with mutated operations', () => {
    const { transaction } = buildTransaction()
    const mutated = new TransactionBuilder(
      new Account(transaction.source, transaction.sequence),
      { fee: transaction.fee, networkPassphrase: Networks.TESTNET },
    )
      .addOperation(
        Operation.payment({
          destination: Keypair.random().publicKey(),
          asset: Asset.native(),
          amount: '1',
        }),
      )
      .setTimeout(30)
      .build()

    expect(() =>
      verifySignedTransaction(transaction, mutated.toXDR(), Networks.TESTNET),
    ).toThrowError(expect.objectContaining({ code: 'SIGNED_TRANSACTION_MISMATCH' }))
  })

  it('rejects a response parsed with a different network passphrase', () => {
    const { transaction } = buildTransaction()

    expect(() =>
      verifySignedTransaction(transaction, transaction.toXDR(), Networks.PUBLIC),
    ).toThrowError(expect.objectContaining({ code: 'SIGNED_TRANSACTION_MISMATCH' }))
  })

  it('warns through the injected logger when signing with hardware', async () => {
    const { transaction, source } = buildTransaction()
    const signed = TransactionBuilder.fromXDR(
      transaction.toXDR(),
      Networks.TESTNET,
    ) as Transaction
    signed.sign(source)
    const wallet: WalletAdapter = {
      capabilities: { hardware: true },
      isConnected: async () => true,
      getPublicKey: async () => source.publicKey(),
      signTransaction: vi.fn().mockResolvedValue(signed.toXDR()),
    }
    const logger = { warn: vi.fn() }

    await signAndVerifyTransaction(transaction, wallet, Networks.TESTNET, { logger })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Hardware wallet signing'),
      { wallet: 'hardware' },
    )
  })
})
