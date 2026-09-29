import type { ISorobanRpcClient } from '@soroban-resurrect/sdk'
import type { Account, rpc } from '@stellar/stellar-sdk'
import * as fx from './fixtures.js'

type Scripted<T> = T | T[]

export interface MockRpcScript {
  /** Responses for successive `simulateTransaction` calls. The last one repeats. */
  simulate?: Scripted<rpc.Api.SimulateTransactionResponse>
  /** Responses for successive `sendTransaction` calls. The last one repeats. */
  send?: Scripted<rpc.Api.SendTransactionResponse>
  /** Responses for successive `getTransaction` calls. The last one repeats. */
  getTransaction?: Scripted<rpc.Api.GetTransactionResponse>
  /** Account returned by `getAccount`; the sequence is bumped on every call. */
  account?: Account
  /** Ledger returned by `getLatestLedger`. */
  latestLedger?: number
  /** Response for `getLedgerEntries` (defaults to "no live entries"). */
  ledgerEntries?: rpc.Api.GetLedgerEntriesResponse
  /** Optional `serverURL`; omit it to force adaptive polling instead of SSE. */
  serverURL?: string
}

export interface MockRpcClient extends ISorobanRpcClient {
  /** Every call in order, e.g. `['simulateTransaction', 'getAccount', ...]`. */
  readonly calls: string[]
  /** Arguments passed to `sendTransaction`, in order. */
  readonly sent: Parameters<ISorobanRpcClient['sendTransaction']>[0][]
}

function sequence<T>(script: Scripted<T>): () => T {
  const queue = Array.isArray(script) ? [...script] : [script]
  return () => (queue.length > 1 ? queue.shift()! : queue[0]!)
}

/**
 * A scripted, in-memory `ISorobanRpcClient`. Pass it as `config.rpcClient`
 * to drive `SorobanResurrect` through detect → restore → confirm → resubmit
 * without a network. Defaults describe the happy restore path.
 */
export function createMockRpcClient(script: MockRpcScript = {}): MockRpcClient {
  const nextSim = sequence(script.simulate ?? [fx.simulateRestore(), fx.simulateSuccess()])
  const nextSend = sequence(script.send ?? fx.sendPending())
  const nextTx = sequence(script.getTransaction ?? fx.txSuccess())
  const acct = script.account ?? fx.account()
  const latestLedger = script.latestLedger ?? 1000
  const calls: string[] = []
  const sent: MockRpcClient['sent'] = []

  return {
    calls,
    sent,
    serverURL: script.serverURL,
    async simulateTransaction() {
      calls.push('simulateTransaction')
      return nextSim()
    },
    async sendTransaction(tx) {
      calls.push('sendTransaction')
      sent.push(tx)
      return nextSend()
    },
    async getTransaction() {
      calls.push('getTransaction')
      return nextTx()
    },
    async getAccount() {
      calls.push('getAccount')
      acct.incrementSequenceNumber()
      return acct
    },
    async getLedgerEntries() {
      calls.push('getLedgerEntries')
      return (
        script.ledgerEntries ??
        ({ entries: [], latestLedger } as unknown as rpc.Api.GetLedgerEntriesResponse)
      )
    },
    async getLatestLedger() {
      calls.push('getLatestLedger')
      return {
        id: 'mock',
        protocolVersion: '22',
        sequence: latestLedger,
      } as unknown as rpc.Api.GetLatestLedgerResponse
    },
  }
}

/** Ready-made scripts for the interesting restore paths. */
export const scenarios = {
  /** No archived state: simulate → send → confirm. */
  noRestore: (): MockRpcScript => ({ simulate: fx.simulateSuccess() }),
  /** Archived footprint: simulate(restore) → restore → confirm → re-simulate → resubmit. */
  restore: (): MockRpcScript => ({ simulate: [fx.simulateRestore(), fx.simulateSuccess()] }),
  /** The restore simulation itself fails. */
  restoreSimulationError: (): MockRpcScript => ({
    simulate: [fx.simulateRestore(), fx.simulateError('HostError: restore footprint invalid')],
  }),
  /** The resubmitted transaction is rejected with `tx_bad_seq`. */
  badSequence: (): MockRpcScript => ({
    simulate: [fx.simulateRestore(), fx.simulateSuccess()],
    send: [fx.sendPending('restore-hash'), fx.sendError('txBadSeq', 'original-hash')],
  }),
  /** Confirmation arrives only after a few polls. */
  slowConfirmation: (polls = 3): MockRpcScript => ({
    getTransaction: [...Array.from({ length: polls }, () => fx.txNotFound()), fx.txSuccess()],
  }),
} satisfies Record<string, (...args: never[]) => MockRpcScript>
