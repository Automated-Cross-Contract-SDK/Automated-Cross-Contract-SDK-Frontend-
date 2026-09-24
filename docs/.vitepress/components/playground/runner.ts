/**
 * In-browser playground runner.
 *
 * The docs site is static and read-only, so this module reproduces the parts of
 * `@soroban-resurrect/sdk` a reader needs to experiment with — the
 * `SorobanResurrect` facade, its state machine, and the `ISorobanRpcClient`
 * injection point — without shipping (or hitting) a real Soroban RPC endpoint.
 *
 * It is intentionally dependency-free and mirrors the SDK's public shapes so
 * the code a reader writes here looks like the code they would write against
 * the real package. State transitions and the order of RPC calls match the SDK
 * exactly (see `packages/sdk/src/SorobanResurrectExecution.ts` and
 * `packages/sdk/src/Executor.ts`); only the transport is faked.
 *
 * Nothing in this file touches the DOM, so it is safe to import during
 * VitePress' server-side render — execution happens on demand in the browser.
 */

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/** The canned RPC behaviours a reader can flip between. */
export type PlaygroundScenario =
  'restore-needed' | 'no-restore' | 'simulation-error' | 'restore-fails'

/** Display metadata for the scenario picker. */
export interface ScenarioOption {
  value: PlaygroundScenario
  label: string
  description: string
}

export const SCENARIOS: ScenarioOption[] = [
  {
    value: 'restore-needed',
    label: 'Restore needed',
    description:
      'The first simulation reports archived ledger entries, so the SDK restores them, then resubmits the original transaction.',
  },
  {
    value: 'no-restore',
    label: 'No restore needed',
    description:
      'Simulation succeeds immediately — the transaction is signed and submitted without any restore step.',
  },
  {
    value: 'simulation-error',
    label: 'Simulation error',
    description:
      'Simulation fails (e.g. a host error). The workflow stops before signing anything.',
  },
  {
    value: 'restore-fails',
    label: 'Restore fails to confirm',
    description:
      'The restore transaction is submitted but never confirms, so the original transaction is never sent.',
  },
]

// ---------------------------------------------------------------------------
// Types mirroring the SDK's public surface
// ---------------------------------------------------------------------------

export type PlaygroundRestoreState =
  | 'idle'
  | 'simulating'
  | 'restore_needed'
  | 'signing_restore'
  | 'submitting_restore'
  | 'confirming_restore'
  | 'submitting_original'
  | 'signing_original'
  | 'success'
  | 'error'

/** A ledger entry the SDK reports as archived. */
export interface ArchivedLedgerEntry {
  keyBase64: string
}

/** Snapshot of the workflow state — mirrors `RestoreStateInfo`. */
export interface PlaygroundStateInfo {
  state: PlaygroundRestoreState
  message: string
  archivedKeys?: ArchivedLedgerEntry[]
  error?: string
}

/** Outcome of `submitWithRestore` — mirrors `ResurrectResult`. */
export interface PlaygroundResurrectResult {
  success: boolean
  originalTxHash?: string
  restoreTxHash?: string
  archivedKeysDetected: number
  error?: string
  errorCode?: string
}

/** A wallet adapter — mirrors `WalletAdapter`. */
export interface PlaygroundWallet {
  isConnected(): Promise<boolean>
  getPublicKey(): Promise<string>
  signTransaction(xdr: string, opts?: { networkPassphrase?: string }): Promise<string>
}

/** Options accepted by the simulated `submitWithRestore`. */
export interface SubmitWithRestoreOptions {
  transaction: unknown
  wallet: PlaygroundWallet
  onRestoreNeeded?: (keys: ArchivedLedgerEntry[]) => void
  onSigningRestore?: () => void
  onSubmittingRestore?: () => void
  onRestoreSubmitted?: (hash: string) => void
  onRestoreConfirmed?: (hash: string) => void
  onSigningOriginal?: () => void
  onOriginalSubmitted?: (hash: string) => void
  onRestoreFailed?: (error: string) => void
}

/** Config accepted by the simulated `SorobanResurrect`. */
export interface PlaygroundConfig {
  rpcUrl?: string
  networkPassphrase?: string
  rpcClient?: FakeRpcClient
  pollIntervalMs?: number
  pollTimeoutMs?: number
  restoreFeeMultiplier?: number
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Telemetry collected while a snippet runs
// ---------------------------------------------------------------------------

export interface RpcCall {
  seq: number
  method: string
  detail: string
}

export interface LogLine {
  level: 'log' | 'info' | 'warn' | 'error'
  text: string
}

export interface RunOutcome {
  logs: LogLine[]
  states: PlaygroundStateInfo[]
  rpcCalls: RpcCall[]
  results: PlaygroundResurrectResult[]
  returned?: unknown
  error?: string
  durationMs: number
}

interface Telemetry {
  rpcCalls: RpcCall[]
  states: PlaygroundStateInfo[]
  results: PlaygroundResurrectResult[]
}

// ---------------------------------------------------------------------------
// Canned data
// ---------------------------------------------------------------------------

const SAMPLE_PUBLIC_KEY = 'GDF3YQCGNJXQJGYQCGNJXQJGYQCGNJXQJGYQCGNJXQJGYQCGNJXQJGYQ'
const CONTRACT_ID = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'

/** Two plausible archived entries reported by the canned simulation. */
const ARCHIVED_KEYS: ArchivedLedgerEntry[] = [
  {
    keyBase64:
      'AAAABgAAAAH0Vp3RwnH1V6DPe1J3lJK/8sSmWHlYlO2H1lmLOJjPYAAAABAAAAABAAAAAgAAAA8AAAAHQmFsYW5jZQAAAAASuHfR6xEDVvR2zYbFho5EVd5C5rGp4sT3BQvHhYb3SgAAAAE=',
  },
  {
    keyBase64:
      'AAAABgAAAAH0Vp3RwnH1V6DPe1J3lJK/8sSmWHlYlO2H1lmLOJjPYAAAABAAAAABAAAAAgAAAA8AAAAFQWRtaW4AAAAAAAASuHfR6xEDVvR2zYbFho5EVd5C5rGp4sT3BQvHhYb3SgAAAAE=',
  },
]

const SAMPLE_TX_XDR =
  'AAAAAgAAAABEY2cb+0d4V7+1mx5m2bR4m2z4n0hQw3V1f0iT5QDxFQAAAGQAAAAAAAAAAQAAAAEAAAAA'

/** Shape of the canned `simulateTransaction` responses below. */
interface FakeSimulationResponse {
  id: string
  latestLedger: number
  events: unknown[]
  _parsed: boolean
  transactionData?: {
    build(): unknown
    getFootprint(): { readOnly(): unknown[]; readWrite(): { toXDR(form?: string): string }[] }
  }
  minResourceFee?: string
  cost?: { cpuInsns: string; memBytes: string }
  result?: unknown
  restorePreamble?: { minResourceFee: string; transactionData: { build(): unknown } }
  error?: string
}

type SimulationTransactionData = NonNullable<FakeSimulationResponse['transactionData']>

function archivedKeyObjects() {
  return ARCHIVED_KEYS.map((entry) => ({ toXDR: () => entry.keyBase64 }))
}

function emptyFootprint() {
  return { readOnly: () => [], readWrite: () => [] }
}

function restoreResponse(seq: number): FakeSimulationResponse {
  const data = { build: () => ({ __kind: 'SorobanTransactionData' }) }
  return {
    id: `sim-${seq}`,
    latestLedger: 1000 + seq,
    events: [],
    _parsed: true,
    transactionData: {
      build: () => ({ __kind: 'SorobanTransactionData' }),
      getFootprint: () => ({ readOnly: () => [], readWrite: () => archivedKeyObjects() }),
    },
    minResourceFee: '100',
    cost: { cpuInsns: '2500000', memBytes: '3000000' },
    result: { auth: [], retval: { switch: () => 0 } },
    restorePreamble: { minResourceFee: '100', transactionData: { build: data.build } },
  }
}

function successResponse(seq: number): FakeSimulationResponse {
  return {
    id: `sim-${seq}`,
    latestLedger: 1000 + seq,
    events: [],
    _parsed: true,
    transactionData: {
      build: () => ({ __kind: 'SorobanTransactionData' }),
      getFootprint: emptyFootprint,
    },
    minResourceFee: '100',
    cost: { cpuInsns: '1200000', memBytes: '1500000' },
    result: { auth: [], retval: { switch: () => 0 } },
  }
}

function errorResponse(seq: number): FakeSimulationResponse {
  return {
    id: `sim-${seq}`,
    latestLedger: 1000 + seq,
    events: [],
    _parsed: true,
    error: 'HostError: Error(Contract, #3) — balance entry is archived',
  }
}

/**
 * Shape-check the same way `rpc.Api.isSimulationRestore` /
 * `isSimulationError` do — a restore response carries a `restorePreamble`.
 */
function isRestoreResponse(response: FakeSimulationResponse): response is FakeSimulationResponse & {
  restorePreamble: NonNullable<FakeSimulationResponse['restorePreamble']>
  transactionData: SimulationTransactionData
} {
  return response.restorePreamble !== undefined
}

function isErrorResponse(
  response: FakeSimulationResponse,
): response is FakeSimulationResponse & { error: string } {
  return response.error !== undefined
}

function extractArchivedKeys(transactionData: SimulationTransactionData): ArchivedLedgerEntry[] {
  return transactionData
    .getFootprint()
    .readWrite()
    .map((key) => ({ keyBase64: key.toXDR('base64') }))
}

// ---------------------------------------------------------------------------
// Fake RPC client (implements the six-method ISorobanRpcClient contract)
// ---------------------------------------------------------------------------

/**
 * A canned, in-memory `ISorobanRpcClient`. Every method returns deterministic
 * data — no network, no wallet — so a flow can be exercised end to end.
 */
export class FakeRpcClient {
  /** Ordered log of every call made through this client. */
  readonly calls: RpcCall[] = []

  private readonly _scenario: PlaygroundScenario
  private readonly _telemetry: Telemetry
  private _simulateCount = 0
  private _accountSequence = 41
  private _restoreConfirmed = false

  constructor(scenario: PlaygroundScenario, telemetry: Telemetry) {
    this._scenario = scenario
    this._telemetry = telemetry
  }

  private _record(method: string, detail: string) {
    const call: RpcCall = { seq: this.calls.length + 1, method, detail }
    this.calls.push(call)
    this._telemetry.rpcCalls.push(call)
    return call
  }

  async simulateTransaction(transaction: unknown) {
    this._simulateCount += 1
    const op = describeOperation(transaction)
    this._record('simulateTransaction', op)

    if (this._scenario === 'simulation-error') {
      return errorResponse(this._simulateCount)
    }
    if (this._scenario === 'no-restore') {
      return successResponse(this._simulateCount)
    }
    // Restore scenarios: archived until the restore confirms on-chain.
    return this._restoreConfirmed
      ? successResponse(this._simulateCount)
      : restoreResponse(this._simulateCount)
  }

  async sendTransaction(transaction: unknown) {
    const op = describeOperation(transaction)
    const isRestore = op === 'restoreFootprint'
    const hash = isRestore ? 'restore-tx-hash' : 'original-tx-hash'
    this._record('sendTransaction', `${op} → ${hash}`)
    return { status: 'PENDING', hash }
  }

  async getTransaction(hash: string) {
    if (hash === 'restore-tx-hash' && this._scenario === 'restore-fails') {
      this._record('getTransaction', `${hash} → FAILED`)
      return { status: 'FAILED' }
    }
    if (hash === 'restore-tx-hash') {
      this._restoreConfirmed = true
    }
    this._record('getTransaction', `${hash} → SUCCESS`)
    return { status: 'SUCCESS' }
  }

  async getAccount(publicKey: string) {
    this._accountSequence += 1
    this._record('getAccount', `${shortKey(publicKey)} (seq ${this._accountSequence})`)
    return {
      accountId: publicKey,
      sequenceNumber: () => String(this._accountSequence),
      sequence: String(this._accountSequence),
    }
  }

  async getLedgerEntries(...keys: unknown[]) {
    this._record('getLedgerEntries', `${keys.length} key(s)`)
    return { entries: [], latestLedger: 1000 }
  }

  async getLatestLedger() {
    this._record('getLatestLedger', 'sequence 1000')
    return { sequence: 1000, id: 'canned-ledger', protocolVersion: 21 }
  }
}

function describeOperation(transaction: unknown): string {
  const ops = (transaction as { operations?: { type?: string }[] } | undefined)?.operations
  const type = ops?.[0]?.type
  return type ?? 'transaction'
}

function shortKey(key: string): string {
  return key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-4)}` : key
}

// ---------------------------------------------------------------------------
// Simulated SorobanResurrect facade
// ---------------------------------------------------------------------------

/**
 * A lightweight stand-in for the SDK's `SorobanResurrect` class. It keeps the
 * same public surface (`state`, `stateInfo`, `onStateChange`, `needsRestore`,
 * `detectArchivedKeys`, `buildRestoreTx`, `submitWithRestore`) and drives the
 * same state machine, so snippets written against it read like real SDK code.
 */
export class PlaygroundSorobanResurrect {
  readonly server: FakeRpcClient
  readonly config: Record<string, unknown>

  state: PlaygroundRestoreState = 'idle'
  stateInfo: PlaygroundStateInfo = { state: 'idle', message: '' }

  private readonly _telemetry: Telemetry
  private readonly _listeners = new Set<(info: PlaygroundStateInfo) => void>()

  constructor(config: PlaygroundConfig = {}, telemetry: Telemetry) {
    this._telemetry = telemetry
    this.server = config.rpcClient ?? new FakeRpcClient('restore-needed', telemetry)
    this.config = {
      rpcUrl: 'https://soroban-testnet.example',
      networkPassphrase: 'Test SDF Network ; September 2015',
      pollIntervalMs: 1000,
      pollTimeoutMs: 60000,
      ...config,
    }
  }

  /** Subscribe to state transitions. Returns an unsubscribe function. */
  onStateChange(listener: (info: PlaygroundStateInfo) => void): () => void {
    this._listeners.add(listener)
    return () => {
      this._listeners.delete(listener)
    }
  }

  /** Reset back to `idle`, clearing archived keys and any error. */
  reset(): void {
    this.state = 'idle'
    this.stateInfo = { state: 'idle', message: '' }
  }

  private _setState(
    state: PlaygroundRestoreState,
    message: string,
    extra: Partial<PlaygroundStateInfo> = {},
  ): void {
    this.state = state
    this.stateInfo = { state, message, ...extra }
    this._telemetry.states.push(this.stateInfo)
    for (const listener of this._listeners) listener(this.stateInfo)
  }

  /** Simulate a transaction. Sets state to `simulating`, like the SDK. */
  async simulate(transaction: unknown) {
    this._setState('simulating', 'Simulating transaction...')
    return this.server.simulateTransaction(transaction)
  }

  /** Detect archived entries via simulation. Never throws. */
  async detectArchivedKeys(transaction: unknown): Promise<ArchivedLedgerEntry[]> {
    const response = await this.simulate(transaction)
    if (isRestoreResponse(response)) return extractArchivedKeys(response.transactionData)
    return []
  }

  /** Convenience wrapper — `true` when at least one archived entry is found. */
  async needsRestore(transaction: unknown): Promise<boolean> {
    const keys = await this.detectArchivedKeys(transaction)
    return keys.length > 0
  }

  /** Build an unsigned restore transaction. Throws when no restore is needed. */
  async buildRestoreTx(sourcePublicKey: string, transaction: unknown) {
    const response = await this.simulate(transaction)
    if (!isRestoreResponse(response)) {
      throw new Error('No archived keys detected — restore transaction not needed')
    }
    const account = await this.server.getAccount(sourcePublicKey)
    return makeRestoreTransaction(account)
  }

  /**
   * Full workflow: simulate → restore if needed → submit the original.
   * Never throws — failures are returned as a `ResurrectResult`.
   *
   * The state sequence mirrors `SorobanResurrect.submitWithRestore` exactly:
   *
   *   restore_needed → signing_restore → submitting_restore →
   *   confirming_restore → submitting_original → signing_original → success
   *
   * On the no-restore path only `signing_original → success` fire, because the
   * facade only emits states for the callbacks the executor actually invokes.
   */
  async submitWithRestore(options: SubmitWithRestoreOptions): Promise<PlaygroundResurrectResult> {
    const { transaction, wallet } = options

    let result: PlaygroundResurrectResult

    try {
      const simulation = await this.server.simulateTransaction(transaction)

      if (isErrorResponse(simulation)) {
        const error = `Simulation error: ${simulation.error}`
        result = {
          success: false,
          archivedKeysDetected: 0,
          error,
          errorCode: 'SIMULATION_FAILED',
        }
        options.onRestoreFailed?.(error)
        return this._finish(result)
      }

      if (isRestoreResponse(simulation)) {
        const archivedKeys = extractArchivedKeys(simulation.transactionData)

        if (!(await wallet.isConnected())) {
          const error = 'Wallet is not connected'
          options.onRestoreFailed?.(error)
          return this._finish({
            success: false,
            archivedKeysDetected: archivedKeys.length,
            error,
            errorCode: 'WALLET_NOT_CONNECTED',
          })
        }

        const publicKey = await wallet.getPublicKey()
        const account = await this.server.getAccount(publicKey)
        const restoreTx = makeRestoreTransaction(account)

        options.onRestoreNeeded?.(archivedKeys)
        this._setState(
          'restore_needed',
          `Detected ${archivedKeys.length} archived ledger entries`,
          {
            archivedKeys,
          },
        )

        options.onSigningRestore?.()
        this._setState('signing_restore', 'Awaiting wallet signature for restore transaction...')
        // The wallet "signs" by echoing the XDR; the fake client is told what
        // kind of transaction this is by receiving the descriptor itself.
        await wallet.signTransaction(restoreTx.toXDR())

        options.onSubmittingRestore?.()
        this._setState('submitting_restore', 'Submitting restore transaction...')
        const restoreSend = await this.server.sendTransaction(restoreTx)
        options.onRestoreSubmitted?.(restoreSend.hash)

        this._setState('confirming_restore', 'Waiting for restore confirmation...')
        const restoreStatus = await this.server.getTransaction(restoreSend.hash)

        if (restoreStatus.status !== 'SUCCESS') {
          const error = 'Restore transaction failed'
          options.onRestoreFailed?.(error)
          return this._finish({
            success: false,
            archivedKeysDetected: archivedKeys.length,
            restoreTxHash: restoreSend.hash,
            error,
            errorCode: 'RESTORE_TX_FAILED',
          })
        }

        options.onRestoreConfirmed?.(restoreSend.hash)
        this._setState(
          'submitting_original',
          'Restore confirmed. Preparing original transaction...',
        )

        // Rebuild the original against a fresh sequence number, then re-simulate.
        const rebuiltAccount = await this.server.getAccount(publicKey)
        const rebuiltTx = rebuildOriginal(transaction, rebuiltAccount)
        await this.server.simulateTransaction(rebuiltTx)

        options.onSigningOriginal?.()
        this._setState('signing_original', 'Signing original transaction...')
        await wallet.signTransaction(rebuiltTx.toXDR())

        const originalSend = await this.server.sendTransaction(rebuiltTx)
        options.onOriginalSubmitted?.(originalSend.hash)
        this._setState('success', 'Original transaction submitted successfully')

        return this._finish({
          success: true,
          originalTxHash: originalSend.hash,
          restoreTxHash: restoreSend.hash,
          archivedKeysDetected: archivedKeys.length,
        })
      }

      // Simulation succeeded and no restore is needed — sign and submit directly.
      options.onSigningOriginal?.()
      this._setState('signing_original', 'Signing original transaction...')
      await wallet.signTransaction(sampleXdrFor(transaction))

      const sendResult = await this.server.sendTransaction(transaction)
      options.onOriginalSubmitted?.(sendResult.hash)
      this._setState('success', 'Original transaction submitted successfully')

      // The SDK still polls for confirmation on this path, even though the
      // success state has already been published.
      const status = await this.server.getTransaction(sendResult.hash)
      if (status.status !== 'SUCCESS') {
        return this._finish({
          success: false,
          archivedKeysDetected: 0,
          error: 'Transaction failed to confirm',
          errorCode: 'ORIGINAL_TX_FAILED',
        })
      }

      return this._finish({
        success: true,
        originalTxHash: sendResult.hash,
        archivedKeysDetected: 0,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      options.onRestoreFailed?.(message)
      return this._finish({ success: false, archivedKeysDetected: 0, error: message })
    }
  }

  private _finish(result: PlaygroundResurrectResult): PlaygroundResurrectResult {
    this._telemetry.results.push(result)
    if (!result.success) {
      this._setState('error', result.error ?? 'Unknown error', { error: result.error })
    }
    return result
  }
}

// ---------------------------------------------------------------------------
// Transaction / wallet helpers exposed to snippets
// ---------------------------------------------------------------------------

interface FakeTransaction {
  toXDR(): string
  source: string
  fee: string
  operations: { type: string; contract?: string; function?: string }[]
}

function makeRestoreTransaction(account: { accountId: string }): FakeTransaction {
  return {
    toXDR: () => 'AAAAAgAAAAByZXN0b3JlLXByZWFtYmxlAAA=',
    source: account.accountId,
    fee: '300',
    operations: [{ type: 'restoreFootprint' }],
  }
}

function rebuildOriginal(transaction: unknown, account: { accountId: string }): FakeTransaction {
  const original = transaction as FakeTransaction
  return { ...original, source: account.accountId } as FakeTransaction
}

function sampleXdrFor(transaction: unknown): string {
  return (transaction as FakeTransaction)?.toXDR?.() ?? SAMPLE_TX_XDR
}

/** Build a sample `invokeContractFunction` transaction to feed the workflow. */
export function buildSampleTransaction(): FakeTransaction {
  return {
    toXDR: () => SAMPLE_TX_XDR,
    source: SAMPLE_PUBLIC_KEY,
    fee: '100',
    operations: [{ type: 'invokeContractFunction', contract: CONTRACT_ID, function: 'withdraw' }],
  }
}

/** A wallet that is connected, has a public key, and "signs" by echoing the XDR. */
export function createMockWallet(): PlaygroundWallet {
  return {
    isConnected: async () => true,
    getPublicKey: async () => SAMPLE_PUBLIC_KEY,
    signTransaction: async (xdr: string) => xdr,
  }
}

/** A wallet that reports itself as disconnected — demonstrates WALLET_NOT_CONNECTED. */
export function createDisconnectedWallet(): PlaygroundWallet {
  return {
    isConnected: async () => false,
    getPublicKey: async () => SAMPLE_PUBLIC_KEY,
    signTransaction: async (xdr: string) => xdr,
  }
}

// ---------------------------------------------------------------------------
// Snippet execution
// ---------------------------------------------------------------------------

/** The snippet loaded into the editor on first render. */
export const DEFAULT_SNIPPET = `// Everything runs in your browser against a canned RPC client.
// Edit this, pick a scenario above, then press Run (or Ctrl/Cmd + Enter).

const rpc = createFakeRpcClient() // scenario comes from the selector

const sr = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.example',
  networkPassphrase: 'Test SDF Network ; September 2015',
  rpcClient: rpc,
})

// Every transition is recorded in the timeline panel below.
sr.onStateChange((info) => console.log(\`[\${info.state}] \${info.message}\`))

const tx = buildSampleTransaction()

console.log('needsRestore ->', await sr.needsRestore(tx))

const result = await sr.submitWithRestore({
  transaction: tx,
  wallet: createMockWallet(),
})

console.log('result ->', result)
`

/** Pretty-print an arbitrary snippet result for the output panel. */
export function formatValue(value: unknown): string {
  return safeStringify(value)
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
  if (typeof value === 'bigint') return `${value}n`
  const seen = new WeakSet<object>()
  try {
    const json = JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === 'bigint') return `${val}n`
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]'
          seen.add(val)
        }
        return val
      },
      2,
    )
    return json ?? String(value)
  } catch {
    return String(value)
  }
}

function createCapturingConsole(logs: LogLine[]): Console {
  const push =
    (level: LogLine['level']) =>
    (...args: unknown[]) => {
      logs.push({ level, text: args.map(safeStringify).join(' ') })
    }
  return {
    log: push('log'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    debug: push('log'),
  } as unknown as Console
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Executes a reader-edited snippet with the simulated SDK injected as globals
 * and collects everything for display: console output, state transitions, RPC
 * calls, and results.
 *
 * The snippet may use top-level `await` and may `return` a value, which is
 * surfaced as the run's return value.
 */
export async function runPlayground(
  code: string,
  scenario: PlaygroundScenario,
): Promise<RunOutcome> {
  const telemetry: Telemetry = { rpcCalls: [], states: [], results: [] }
  const logs: LogLine[] = []
  const startedAt = Date.now()

  class SorobanResurrect extends PlaygroundSorobanResurrect {
    constructor(config: PlaygroundConfig = {}) {
      super(config, telemetry)
    }
  }

  const createFakeRpcClient = (selected: PlaygroundScenario = scenario) =>
    new FakeRpcClient(selected, telemetry)

  const outcome: RunOutcome = {
    logs,
    states: telemetry.states,
    rpcCalls: telemetry.rpcCalls,
    results: telemetry.results,
    durationMs: 0,
  }

  try {
    const run = new Function(
      'SorobanResurrect',
      'createFakeRpcClient',
      'createRpcClient',
      'buildSampleTransaction',
      'createMockWallet',
      'createDisconnectedWallet',
      'console',
      'sleep',
      'scenario',
      `"use strict";\nreturn (async () => {\n${code}\n})()`,
    )

    outcome.returned = await run(
      SorobanResurrect,
      createFakeRpcClient,
      createFakeRpcClient,
      buildSampleTransaction,
      createMockWallet,
      createDisconnectedWallet,
      createCapturingConsole(logs),
      sleep,
      scenario,
    )
  } catch (err) {
    outcome.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  }

  outcome.durationMs = Date.now() - startedAt
  return outcome
}
