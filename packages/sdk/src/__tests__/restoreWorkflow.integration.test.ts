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
      transaction: makeSampleTx(),
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
    })

    // RPC calls happen in the expected end-to-end order: simulate -> account
    // lookup -> submit restore -> poll for confirmation -> re-simulate the
    // rebuilt original -> submit original.
    expect(callLog).toEqual([
      'simulateTransaction',
      'getAccount',
      'sendTransaction:restore',
      'getTransaction',
      'getAccount',
      'simulateTransaction',
      'sendTransaction:original',
    ])

    // Wallet signs both the restore and the rebuilt original transaction.
    expect(wallet.signTransaction).toHaveBeenCalledTimes(2)

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

  it('propagates every workflow state transition through the SorobanResurrect facade', async () => {
    const server = makeIntegrationServer(callLog)
    const wallet = makeWallet()
    const resurrect = new SorobanResurrect(defaultConfig)
    // Swap in the mocked RPC server so the full real workflow runs against
    // a realistic, controlled sequence of responses instead of the network.
    ;(resurrect as unknown as { server: rpc.Server }).server = server

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
