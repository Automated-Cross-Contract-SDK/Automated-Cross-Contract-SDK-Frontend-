import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  rpc,
  TransactionBuilder,
  Account,
  Networks,
  Operation,
  Keypair,
  Transaction,
  SorobanDataBuilder,
} from '@stellar/stellar-sdk'
import { SorobanResurrect } from '../SorobanResurrect.js'
import type { WalletAdapter, SorobanResurrectConfig } from '../types.js'

function makeSampleTx(): Transaction {
  const kp = Keypair.random()
  const account = new Account(kp.publicKey(), '1')
  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(30)
    .build()
}

function makeWallet(): WalletAdapter {
  return {
    isConnected: vi.fn().mockResolvedValue(true),
    getPublicKey: vi.fn().mockResolvedValue(Keypair.random().publicKey()),
    signTransaction: vi.fn().mockImplementation(async (tx: string) => tx),
  }
}

const mockSorobanData = new SorobanDataBuilder().build()

function makeSuccessResponse() {
  return {
    id: '1',
    latestLedger: 100,
    events: [],
    _parsed: true,
    transactionData: {
      build: () => mockSorobanData,
      getFootprint: () => ({ readOnly: () => [], readWrite: () => [] }),
    },
    minResourceFee: '100',
    cost: { cpuInsns: '100', memBytes: '100' },
    result: { auth: [], retval: { switch: () => 0 } },
  }
}

function makeRestoreResponse() {
  const mockLedgerKey = { toXDR: () => 'base64-key' }
  return {
    id: '1',
    latestLedger: 100,
    events: [],
    _parsed: true,
    transactionData: {
      build: () => mockSorobanData,
      getFootprint: () => ({ readOnly: () => [], readWrite: () => [mockLedgerKey] }),
    },
    minResourceFee: '100',
    cost: { cpuInsns: '100', memBytes: '100' },
    result: { auth: [], retval: { switch: () => 0 } },
    restorePreamble: {
      minResourceFee: '100',
      transactionData: { build: () => mockSorobanData },
    },
  }
}

function makeErrorResponse() {
  return {
    id: '1',
    latestLedger: 100,
    events: [],
    _parsed: true,
    error: 'simulation failed',
  }
}

const testConfig: SorobanResurrectConfig = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
  pollIntervalMs: 10,
  pollTimeoutMs: 5000,
}

const ALL_CALLBACK_NAMES = [
  'onRestoreNeeded',
  'onSigningRestore',
  'onSubmittingRestore',
  'onRestoreSubmitted',
  'onRestoreConfirmed',
  'onSigningOriginal',
  'onOriginalSubmitted',
  'onRestoreFailed',
] as const

function makeOrderedCallbacks() {
  const order: string[] = []
  const callbacks = {} as Record<(typeof ALL_CALLBACK_NAMES)[number], (...args: unknown[]) => void>
  for (const name of ALL_CALLBACK_NAMES) {
    callbacks[name] = vi.fn((...args: unknown[]) => {
      order.push(name)
    })
  }
  return { order, callbacks }
}

describe('SorobanResurrect.submitWithRestore — callback invocation ordering', () => {
  let resurrect: SorobanResurrect

  beforeEach(() => {
    resurrect = new SorobanResurrect(testConfig)
  })

  it('invokes callbacks in the documented order for the full restore-then-submit flow', async () => {
    vi.spyOn(resurrect.server, 'simulateTransaction')
      .mockResolvedValueOnce(makeRestoreResponse() as never)
      .mockResolvedValueOnce(makeSuccessResponse() as never)
    vi.spyOn(resurrect.server, 'getAccount').mockResolvedValue(
      new Account(Keypair.random().publicKey(), '2') as never,
    )
    vi.spyOn(resurrect.server, 'sendTransaction')
      .mockResolvedValueOnce({ hash: 'restore-hash' } as never)
      .mockResolvedValueOnce({ hash: 'original-hash' } as never)
    vi.spyOn(resurrect.server, 'getTransaction').mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
    } as never)

    const { order, callbacks } = makeOrderedCallbacks()

    const result = await resurrect.submitWithRestore({
      transaction: makeSampleTx(),
      wallet: makeWallet(),
      ...callbacks,
    })

    expect(result.success).toBe(true)
    expect(order).toEqual([
      'onRestoreNeeded',
      'onSigningRestore',
      'onSubmittingRestore',
      'onRestoreSubmitted',
      'onRestoreConfirmed',
      'onSigningOriginal',
      'onOriginalSubmitted',
    ])
    expect(callbacks.onRestoreFailed).not.toHaveBeenCalled()
  })

  it('invokes only onSigningOriginal then onOriginalSubmitted when no restore is needed', async () => {
    vi.spyOn(resurrect.server, 'simulateTransaction').mockResolvedValue(
      makeSuccessResponse() as never,
    )
    vi.spyOn(resurrect.server, 'sendTransaction').mockResolvedValue({
      hash: 'direct-hash',
    } as never)
    vi.spyOn(resurrect.server, 'getTransaction').mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
    } as never)

    const { order, callbacks } = makeOrderedCallbacks()

    const result = await resurrect.submitWithRestore({
      transaction: makeSampleTx(),
      wallet: makeWallet(),
      ...callbacks,
    })

    expect(result.success).toBe(true)
    expect(order).toEqual(['onSigningOriginal', 'onOriginalSubmitted'])

    for (const name of [
      'onRestoreNeeded',
      'onSigningRestore',
      'onSubmittingRestore',
      'onRestoreSubmitted',
      'onRestoreConfirmed',
      'onRestoreFailed',
    ] as const) {
      expect(callbacks[name]).not.toHaveBeenCalled()
    }
  })

  it('stops after onRestoreFailed and never reaches later callbacks when the restore transaction fails on-chain', async () => {
    vi.spyOn(resurrect.server, 'simulateTransaction').mockResolvedValue(
      makeRestoreResponse() as never,
    )
    vi.spyOn(resurrect.server, 'getAccount').mockResolvedValue(
      new Account(Keypair.random().publicKey(), '2') as never,
    )
    vi.spyOn(resurrect.server, 'sendTransaction').mockResolvedValue({
      hash: 'restore-hash',
    } as never)
    vi.spyOn(resurrect.server, 'getTransaction').mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.FAILED,
    } as never)

    const { order, callbacks } = makeOrderedCallbacks()

    const result = await resurrect.submitWithRestore({
      transaction: makeSampleTx(),
      wallet: makeWallet(),
      ...callbacks,
    })

    expect(result.success).toBe(false)
    expect(order).toEqual([
      'onRestoreNeeded',
      'onSigningRestore',
      'onSubmittingRestore',
      'onRestoreSubmitted',
      'onRestoreFailed',
    ])

    for (const name of ['onRestoreConfirmed', 'onSigningOriginal', 'onOriginalSubmitted'] as const) {
      expect(callbacks[name]).not.toHaveBeenCalled()
    }
  })

  it('calls only onRestoreFailed, before any signing callbacks, when the wallet is not connected', async () => {
    vi.spyOn(resurrect.server, 'simulateTransaction').mockResolvedValue(
      makeRestoreResponse() as never,
    )

    const wallet = makeWallet()
    wallet.isConnected = vi.fn().mockResolvedValue(false)

    const { order, callbacks } = makeOrderedCallbacks()

    const result = await resurrect.submitWithRestore({
      transaction: makeSampleTx(),
      wallet,
      ...callbacks,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Wallet is not connected')
    expect(order).toEqual(['onRestoreFailed'])
  })

  it('calls only onRestoreFailed when the initial simulation errors', async () => {
    vi.spyOn(resurrect.server, 'simulateTransaction').mockResolvedValue(
      makeErrorResponse() as never,
    )

    const { order, callbacks } = makeOrderedCallbacks()

    const result = await resurrect.submitWithRestore({
      transaction: makeSampleTx(),
      wallet: makeWallet(),
      ...callbacks,
    })

    expect(result.success).toBe(false)
    expect(order).toEqual(['onRestoreFailed'])
  })

  it('calls onRestoreFailed and stops if the signed original transaction cannot be parsed after a successful restore', async () => {
    vi.spyOn(resurrect.server, 'simulateTransaction')
      .mockResolvedValueOnce(makeRestoreResponse() as never)
      .mockResolvedValueOnce(makeSuccessResponse() as never)
    vi.spyOn(resurrect.server, 'getAccount').mockResolvedValue(
      new Account(Keypair.random().publicKey(), '2') as never,
    )
    vi.spyOn(resurrect.server, 'sendTransaction').mockResolvedValue({
      hash: 'restore-hash',
    } as never)
    vi.spyOn(resurrect.server, 'getTransaction').mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
    } as never)

    const wallet = makeWallet()
    // First call signs the restore tx (valid XDR passthrough). Second call
    // (signing the original tx) returns a structurally valid XDR envelope
    // that parses to a FeeBumpTransaction rather than a Transaction, which
    // is exactly what the `instanceof Transaction` guard is meant to catch.
    const feeBumpXdr = TransactionBuilder.buildFeeBumpTransaction(
      Keypair.random().publicKey(),
      '1000',
      makeSampleTx(),
      Networks.TESTNET,
    ).toXDR()
    let call = 0
    wallet.signTransaction = vi.fn().mockImplementation(async (xdr: string) => {
      call++
      return call === 1 ? xdr : feeBumpXdr
    })

    const { order, callbacks } = makeOrderedCallbacks()

    const result = await resurrect.submitWithRestore({
      transaction: makeSampleTx(),
      wallet,
      ...callbacks,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Failed to parse signed original transaction')
    expect(order).toEqual([
      'onRestoreNeeded',
      'onSigningRestore',
      'onSubmittingRestore',
      'onRestoreSubmitted',
      'onRestoreConfirmed',
      'onSigningOriginal',
      'onRestoreFailed',
    ])
    expect(callbacks.onOriginalSubmitted).not.toHaveBeenCalled()
  })

  it('drives instance state transitions in step with the callback order', async () => {
    vi.spyOn(resurrect.server, 'simulateTransaction')
      .mockResolvedValueOnce(makeRestoreResponse() as never)
      .mockResolvedValueOnce(makeSuccessResponse() as never)
    vi.spyOn(resurrect.server, 'getAccount').mockResolvedValue(
      new Account(Keypair.random().publicKey(), '2') as never,
    )
    vi.spyOn(resurrect.server, 'sendTransaction')
      .mockResolvedValueOnce({ hash: 'restore-hash' } as never)
      .mockResolvedValueOnce({ hash: 'original-hash' } as never)
    vi.spyOn(resurrect.server, 'getTransaction').mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
    } as never)

    const states: string[] = []
    resurrect.onStateChange((info) => states.push(info.state))

    await resurrect.submitWithRestore({
      transaction: makeSampleTx(),
      wallet: makeWallet(),
    })

    expect(states).toEqual([
      'restore_needed',
      'signing_restore',
      'submitting_restore',
      'confirming_restore',
      'submitting_original',
      'signing_original',
      'success',
    ])
  })

  // ── Regression test for Bug #32 ────────────────────────────────────────
  // Original bug: onRestoreFailed callback was passed through without
  // triggering state management, causing inconsistent callback behavior.
  // The fix wraps onRestoreFailed with setState('error', ...) so that
  // the state reflects the failure when the user's callback fires.
  it('[regression #32] sets error state BEFORE invoking onRestoreFailed callback', async () => {
    vi.spyOn(resurrect.server, 'simulateTransaction').mockResolvedValue(
      makeErrorResponse() as never,
    )

    let stateInCallback: string | undefined

    await resurrect.submitWithRestore({
      transaction: makeSampleTx(),
      wallet: makeWallet(),
      onRestoreFailed: () => {
        stateInCallback = resurrect.state
      },
    })

    // After submitWithRestore completes, state must be 'error'
    expect(resurrect.state).toBe('error')
    expect(resurrect.stateInfo.error).toBeTruthy()

    // The onRestoreFailed callback should have been invoked, and by the
    // time it runs the instance state should already reflect the failure.
    // This prevents UI race conditions where the callback fires before
    // state observers are notified.
    expect(stateInCallback).toBe('error')
  })
})
