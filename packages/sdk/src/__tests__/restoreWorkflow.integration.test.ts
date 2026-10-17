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
import { executeWithRestore } from '../Executor.js'
import { SorobanResurrect } from '../SorobanResurrect.js'
import type { WalletAdapter, SorobanResurrectConfig, RestoreStateInfo } from '../types.js'

/**
 * End-to-end integration test for the full restore workflow, driven through
 * a realistic sequence of mocked Soroban RPC responses:
 *
 *   simulate (restore needed) -> build restore tx -> sign & submit restore
 *   -> poll for confirmation -> rebuild original tx -> re-simulate
 *   -> sign & submit original -> resolve
 *
 * Unlike the unit tests in Executor.test.ts / Restorer.test.ts (which
 * exercise individual functions in isolation), this suite drives the real
 * orchestration in Executor.ts (and, for one scenario, the public
 * SorobanResurrect facade) against a single mocked `rpc.Server`, asserting
 * both the exact order RPC methods are invoked in and the data that flows
 * between each stage.
 */

function makeSampleTx(): Transaction {
  const kp = Keypair.random()
  const account = new Account(kp.publicKey(), '41')
  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setTimeout(30)
    .build()
}

function makeExpiredSampleTx(): Transaction {
  const kp = Keypair.random()
  const account = new Account(kp.publicKey(), '41')
  const now = Math.floor(Date.now() / 1000)
  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setTimebounds(0, now - 1)
    .build()
}

function makeWallet(): WalletAdapter {
  return {
    isConnected: vi.fn().mockResolvedValue(true),
    getPublicKey: vi.fn().mockResolvedValue(Keypair.random().publicKey()),
    signTransaction: vi.fn().mockImplementation(async (tx: string) => tx),
  }
}

const defaultConfig: SorobanResurrectConfig = {
  rpcUrl: 'https://testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
  pollIntervalMs: 10,
  pollTimeoutMs: 2000,
}

const mockSorobanData = new SorobanDataBuilder().build()
const archivedLedgerKey = { toXDR: () => 'archived-key-base64' }

function makeRestoreSimResponse() {
  return {
    id: 'sim-1',
    latestLedger: 1000,
    events: [],
    _parsed: true,
    transactionData: {
      build: () => mockSorobanData,
      getFootprint: () => ({ readOnly: () => [], readWrite: () => [archivedLedgerKey] }),
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

function makeRebuildSimResponse() {
  return {
    id: 'sim-2',
    latestLedger: 1005,
    events: [],
    _parsed: true,
    transactionData: { build: () => mockSorobanData },
    minResourceFee: '100',
    cost: { cpuInsns: '100', memBytes: '100' },
    result: { auth: [], retval: { switch: () => 0 } },
  }
}

/** Builds a mock `rpc.Server` that walks through a realistic restore workflow. */
function makeIntegrationServer(callLog: string[]) {
  const restoreAccount = new Account(Keypair.random().publicKey(), '5')
  const rebuildAccount = new Account(Keypair.random().publicKey(), '6')

  const server = {
    simulateTransaction: vi.fn().mockImplementation(async () => {
      callLog.push('simulateTransaction')
      // First call: original tx simulation reports archived entries.
      // Second call: re-simulation inside buildOriginalAfterRestore succeeds.
      return callLog.filter((c) => c === 'simulateTransaction').length === 1
        ? makeRestoreSimResponse()
        : makeRebuildSimResponse()
    }),
    getAccount: vi.fn().mockImplementation(async () => {
      callLog.push('getAccount')
      return callLog.filter((c) => c === 'getAccount').length === 1 ? restoreAccount : rebuildAccount
    }),
    sendTransaction: vi
      .fn()
      .mockImplementationOnce(async () => {
        callLog.push('sendTransaction:restore')
        return { hash: 'restore-tx-hash' }
      })
      .mockImplementationOnce(async () => {
        callLog.push('sendTransaction:original')
        return { hash: 'original-tx-hash' }
      }),
    getLatestLedger: vi.fn().mockImplementation(async () => {
      callLog.push('getLatestLedger')
      return { sequence: 100 }
    }),
    getTransaction: vi.fn().mockImplementation(async () => {
      callLog.push('getTransaction')
      return { status: rpc.Api.GetTransactionStatus.SUCCESS }
    }),
    getLedgerEntries: vi.fn(),
  } as unknown as rpc.Server

  return server
}

describe('full restore workflow integration', () => {
  let callLog: string[]

  beforeEach(() => {
    callLog = []
  })

  it('drives the full restore-and-resubmit workflow through executeWithRestore in the correct order', async () => {
    const server = makeIntegrationServer(callLog)
    const wallet = makeWallet()
    const originalTx = makeSampleTx()

    const onRestoreNeeded = vi.fn()
    const onSigningRestore = vi.fn()
    const onSubmittingRestore = vi.fn()
    const onRestoreSubmitted = vi.fn()
    const onRestoreConfirmed = vi.fn()
    const onSigningOriginal = vi.fn()
    const onOriginalSubmitted = vi.fn()
    const onRestoreFailed = vi.fn()

    const result = await executeWithRestore({
      server,
      transaction: originalTx,
      wallet,
      config: defaultConfig,
      onRestoreNeeded,
      onSigningRestore,
      onSubmittingRestore,
      onRestoreSubmitted,
      onRestoreConfirmed,
      onSigningOriginal,
      onOriginalSubmitted,
      onRestoreFailed,
    })

    // Final result reflects both the restore and original transaction hashes.
    expect(result).toEqual({
      success: true,
      originalTxHash: 'original-tx-hash',
      restoreTxHash: 'restore-tx-hash',
      archivedKeysDetected: 1,
      sequenceRetries: 0,
    })

    // RPC calls happen in the expected end-to-end order: simulate -> account
    // lookup -> submit restore -> poll for confirmation -> re-simulate the
    // rebuilt original -> submit original.
    expect(callLog).toEqual([
      'simulateTransaction',
      'getAccount',
      'getLatestLedger',
      'sendTransaction:restore',
      'getTransaction',
      'getAccount',
      'simulateTransaction',
      'sendTransaction:original',
      'getTransaction',
    ])

    // Wallet signs both the restore and the rebuilt original transaction.
    expect(wallet.signTransaction).toHaveBeenCalledTimes(2)
    expect(server.simulateTransaction).toHaveBeenCalledTimes(2)

    const rebuiltOriginal = vi.mocked(server.simulateTransaction).mock.calls[1][0]
    expect(rebuiltOriginal).toBeInstanceOf(Transaction)
    if (rebuiltOriginal instanceof Transaction) {
      expect(rebuiltOriginal.operations.map((operation) => operation.type)).toEqual(
        originalTx.operations.map((operation) => operation.type),
      )
    }

    // Each submitted envelope must be the exact envelope returned by the
    // corresponding wallet-signing call, in restore-then-original order.
    expect(vi.mocked(server.sendTransaction).mock.calls.map(([tx]) => tx.toXDR())).toEqual(
      vi.mocked(wallet.signTransaction).mock.calls.map(([signedXdr]) => signedXdr),
    )

    // Callbacks fire in the expected order with the right payloads.
    expect(onRestoreNeeded).toHaveBeenCalledWith([
      expect.objectContaining({ keyBase64: 'archived-key-base64' }),
    ])
    expect(onSigningRestore).toHaveBeenCalledTimes(1)
    expect(onSubmittingRestore).toHaveBeenCalledTimes(1)
    expect(onRestoreSubmitted).toHaveBeenCalledWith('restore-tx-hash')
    expect(onRestoreConfirmed).toHaveBeenCalledWith('restore-tx-hash')
    expect(onSigningOriginal).toHaveBeenCalledTimes(1)
    expect(onOriginalSubmitted).toHaveBeenCalledWith('original-tx-hash')
    expect(onRestoreFailed).not.toHaveBeenCalled()

    const restoreCallOrder = onRestoreNeeded.mock.invocationCallOrder[0]
    const signingCallOrder = onSigningRestore.mock.invocationCallOrder[0]
    const submittingCallOrder = onSubmittingRestore.mock.invocationCallOrder[0]
    const submittedCallOrder = onRestoreSubmitted.mock.invocationCallOrder[0]
    const confirmedCallOrder = onRestoreConfirmed.mock.invocationCallOrder[0]
    const signingOriginalCallOrder = onSigningOriginal.mock.invocationCallOrder[0]
    const originalSubmittedCallOrder = onOriginalSubmitted.mock.invocationCallOrder[0]

    expect(restoreCallOrder).toBeLessThan(signingCallOrder)
    expect(signingCallOrder).toBeLessThan(submittingCallOrder)
    expect(submittingCallOrder).toBeLessThan(submittedCallOrder)
    expect(submittedCallOrder).toBeLessThan(confirmedCallOrder)
    expect(confirmedCallOrder).toBeLessThan(signingOriginalCallOrder)
    expect(signingOriginalCallOrder).toBeLessThan(originalSubmittedCallOrder)
  })

  it('does not submit a restore after wallet approval if its ledger bounds are stale', async () => {
    const server = makeIntegrationServer(callLog)
    vi.mocked(server.getLatestLedger).mockResolvedValue({ sequence: 130 } as never)

    const result = await executeWithRestore({
      server,
      transaction: makeSampleTx(),
      wallet: makeWallet(),
      config: defaultConfig,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Restore preamble is stale')
    expect(server.sendTransaction).not.toHaveBeenCalled()
  })

  it('propagates every workflow state transition through the SorobanResurrect facade', async () => {
    const server = makeIntegrationServer(callLog)
    const wallet = makeWallet()
    const resurrect = new SorobanResurrect({
      ...defaultConfig,
      rpcClient: server,
    })

    const states: RestoreStateInfo[] = []
    resurrect.onStateChange((info) => states.push({ ...info }))

    const result = await resurrect.submitWithRestore({
      transaction: makeSampleTx(),
      wallet,
    })

    expect(result.success).toBe(true)
    expect(result.originalTxHash).toBe('original-tx-hash')
    expect(result.restoreTxHash).toBe('restore-tx-hash')

    expect(states.map((s) => s.state)).toEqual([
      'restore_needed',
      'signing_restore',
      'submitting_restore',
      'confirming_restore',
      'submitting_original',
      'signing_original',
      'success',
    ])

    expect(resurrect.state).toBe('success')
    expect(resurrect.stateInfo.error).toBeUndefined()
  })

  it('previews archived entries, fee, and operation types without a wallet or submission', async () => {
    const server = makeIntegrationServer(callLog)
    const resurrect = new SorobanResurrect({
      ...defaultConfig,
      rpcClient: server,
    })

    const preview = await resurrect.previewRestore(makeSampleTx())

    expect(preview).toMatchObject({
      wouldNeedRestore: true,
      archivedKeysDetected: 1,
      estimatedRestoreFee: '300',
      intendedOperations: ['restoreFootprint'],
    })
    expect(preview.archivedKeys[0]).toMatchObject({
      keyBase64: 'archived-key-base64',
    })
    expect(server.simulateTransaction).toHaveBeenCalledTimes(1)
    expect(server.sendTransaction).not.toHaveBeenCalled()
    expect(server.getAccount).not.toHaveBeenCalled()
    expect(callLog).toEqual(['simulateTransaction'])
    expect(resurrect.state).toBe('idle')
  })

  it('returns simulation errors from a preview without submitting', async () => {
    const server = {
      simulateTransaction: vi.fn().mockResolvedValue({
        error: 'simulation rejected',
      } as never),
      getAccount: vi.fn(),
      sendTransaction: vi.fn(),
      getTransaction: vi.fn(),
      getLedgerEntries: vi.fn(),
    } as unknown as rpc.Server
    const resurrect = new SorobanResurrect({
      ...defaultConfig,
      rpcClient: server,
    })

    const preview = await resurrect.previewRestore(makeSampleTx())

    expect(preview.simulationError).toBe('simulation rejected')
    expect(preview.failure).toMatchObject({
      stage: 'simulation',
      code: 'SIMULATION_FAILED',
    })
    expect(server.sendTransaction).not.toHaveBeenCalled()
  })

  it('supports dry-run submit options without signing, submitting, or recording history', async () => {
    const server = makeIntegrationServer(callLog)
    const wallet = makeWallet()
    const resurrect = new SorobanResurrect({
      ...defaultConfig,
      rpcClient: server,
    })

    const result = await resurrect.submitWithRestore({
      transaction: makeSampleTx(),
      wallet,
      dryRun: true,
    })

    expect(result).toMatchObject({
      success: true,
      dryRun: true,
      dryRunResult: {
        wouldNeedRestore: true,
        archivedKeysDetected: 1,
        estimatedRestoreFee: '300',
        intendedOperations: ['restoreFootprint'],
      },
    })
    expect(result.historyId).toBeUndefined()
    expect(wallet.signTransaction).not.toHaveBeenCalled()
    expect(server.sendTransaction).not.toHaveBeenCalled()
    expect(server.getAccount).not.toHaveBeenCalled()
    expect(callLog).toEqual(['simulateTransaction'])
  })

  it('returns a typed expired outcome and does not sign or submit the original transaction', async () => {
    const server = makeIntegrationServer(callLog)
    const wallet = makeWallet()
    const onRestoreFailed = vi.fn()

    const result = await executeWithRestore({
      server,
      transaction: makeExpiredSampleTx(),
      wallet,
      config: defaultConfig,
      onRestoreFailed,
    })

    expect(result).toMatchObject({
      success: false,
      restoreTxHash: 'restore-tx-hash',
      archivedKeysDetected: 1,
      errorCode: 'ORIGINAL_TRANSACTION_EXPIRED',
      failure: {
        stage: 'rebuild',
        code: 'ORIGINAL_TRANSACTION_EXPIRED',
        retryable: false,
      },
      expiredTransaction: {
        originalTimeBounds: {
          minTime: 0,
        },
      },
    })
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1)
    expect(server.sendTransaction).toHaveBeenCalledTimes(1)
    expect(server.getAccount).toHaveBeenCalledTimes(1)
    expect(server.simulateTransaction).toHaveBeenCalledTimes(1)
    expect(onRestoreFailed).toHaveBeenCalledWith(result.error)
  })

  it('rebuilds an expired original only when the caller approves replacement bounds', async () => {
    const server = makeIntegrationServer(callLog)
    const wallet = makeWallet()
    const now = Math.floor(Date.now() / 1000)
    const approveExpiredRebuild = vi.fn().mockResolvedValue({
      minTime: now,
      maxTime: now + 120,
    })

    const result = await executeWithRestore({
      server,
      transaction: makeExpiredSampleTx(),
      wallet,
      config: defaultConfig,
      approveExpiredRebuild,
    })

    expect(result.success).toBe(true)
    expect(result.originalTxHash).toBe('original-tx-hash')
    expect(approveExpiredRebuild).toHaveBeenCalledWith(
      expect.objectContaining({
        originalTimeBounds: expect.objectContaining({ minTime: 0 }),
      }),
    )
    expect(wallet.signTransaction).toHaveBeenCalledTimes(2)
    expect(server.sendTransaction).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid replacement bounds returned by the approval callback', async () => {
    const server = makeIntegrationServer(callLog)
    const wallet = makeWallet()
    const now = Math.floor(Date.now() / 1000)

    const result = await executeWithRestore({
      server,
      transaction: makeExpiredSampleTx(),
      wallet,
      config: defaultConfig,
      approveExpiredRebuild: () => ({ minTime: now, maxTime: now }),
    })

    expect(result).toMatchObject({
      success: false,
      restoreTxHash: 'restore-tx-hash',
      errorCode: 'INVALID_REBUILD_TIME_BOUNDS',
      failure: {
        stage: 'rebuild',
        code: 'INVALID_REBUILD_TIME_BOUNDS',
      },
    })
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1)
    expect(server.sendTransaction).toHaveBeenCalledTimes(1)
  })

  it('stops the workflow and never submits the original tx if the restore transaction fails to confirm', async () => {
    const server = makeIntegrationServer(callLog)
    vi.mocked(server.getTransaction).mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.FAILED,
    } as never)

    const wallet = makeWallet()
    const onRestoreFailed = vi.fn()
    const onOriginalSubmitted = vi.fn()

    const result = await executeWithRestore({
      server,
      transaction: makeSampleTx(),
      wallet,
      config: defaultConfig,
      onRestoreFailed,
      onOriginalSubmitted,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Restore transaction failed')
    expect(result.restoreTxHash).toBe('restore-tx-hash')
    expect(onRestoreFailed).toHaveBeenCalledWith('Restore transaction failed')
    expect(onOriginalSubmitted).not.toHaveBeenCalled()

    // Only the restore transaction was sent — the original was never rebuilt or submitted.
    expect(server.sendTransaction).toHaveBeenCalledTimes(1)
    expect(callLog).not.toContain('sendTransaction:original')
  })

  it('distinguishes rejection at restore signing and never submits the unsigned restore tx', async () => {
    const server = makeIntegrationServer(callLog)
    const wallet = makeWallet()
    vi.mocked(wallet.signTransaction).mockRejectedValueOnce(
      new Error('User rejected restore signing'),
    )

    const result = await executeWithRestore({
      server,
      transaction: makeSampleTx(),
      wallet,
      config: defaultConfig,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('User rejected restore signing')
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1)
    expect(server.sendTransaction).not.toHaveBeenCalled()
    expect(callLog).not.toContain('sendTransaction:restore')
    expect(callLog).not.toContain('sendTransaction:original')
  })

  it('distinguishes rejection at original signing and never submits the unsigned original tx', async () => {
    const server = makeIntegrationServer(callLog)
    const wallet = makeWallet()
    vi.mocked(wallet.signTransaction)
      .mockImplementationOnce(async (tx: string) => tx)
      .mockRejectedValueOnce(new Error('User rejected original signing'))

    const result = await executeWithRestore({
      server,
      transaction: makeSampleTx(),
      wallet,
      config: defaultConfig,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('User rejected original signing')
    expect(wallet.signTransaction).toHaveBeenCalledTimes(2)
    expect(server.sendTransaction).toHaveBeenCalledTimes(1)
    expect(callLog).toContain('sendTransaction:restore')
    expect(callLog).not.toContain('sendTransaction:original')
  })

  it('submits directly without a restore step when simulation reports no archived entries', async () => {
    const wallet = makeWallet()
    const server = {
      simulateTransaction: vi.fn().mockResolvedValue(makeRebuildSimResponse() as never),
      getAccount: vi.fn(),
      sendTransaction: vi.fn().mockResolvedValue({ hash: 'direct-tx-hash' } as never),
      getTransaction: vi
        .fn()
        .mockResolvedValue({ status: rpc.Api.GetTransactionStatus.SUCCESS } as never),
      getLedgerEntries: vi.fn(),
    } as unknown as rpc.Server

    const onRestoreNeeded = vi.fn()
    const onOriginalSubmitted = vi.fn()

    const result = await executeWithRestore({
      server,
      transaction: makeSampleTx(),
      wallet,
      config: defaultConfig,
      onRestoreNeeded,
      onOriginalSubmitted,
    })

    expect(result).toEqual({
      success: true,
      originalTxHash: 'direct-tx-hash',
      archivedKeysDetected: 0,
    })
    expect(onRestoreNeeded).not.toHaveBeenCalled()
    expect(onOriginalSubmitted).toHaveBeenCalledWith('direct-tx-hash')
    expect(server.getTransaction).toHaveBeenCalledTimes(1)
  })
})
