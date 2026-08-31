/**
 * @file TransactionFailure.ts
 *
 * Decodes a failed Soroban RPC transaction response into a structured,
 * human-readable {@link OnchainError}.
 *
 * When an on-chain transaction fails, `GetTransactionResponse` carries the
 * reason in binary XDR — the transaction result code, per-operation result
 * codes, and (for Soroban) a list of `DiagnosticEvent`s that includes the
 * contract error and any host-emitted messages. None of that is surfaced by
 * the raw RPC `status`, so integrators can't tell a user *why* a contract
 * call reverted. {@link parseTransactionFailure} turns it into plain strings.
 */

import { rpc, xdr, scValToNative } from '@stellar/stellar-sdk'

/**
 * Structured, human-readable explanation of an on-chain transaction failure.
 *
 * Surfaced on {@link ResurrectResult.onchainError} whenever the original (or
 * restore) transaction confirms in a `FAILED` state.
 */
export interface OnchainError {
  /**
   * Top-level transaction result code, e.g. `"txFailed"`,
   * `"txInsufficientFee"`, `"txSorobanInvalid"`. `"unknown"` when the result
   * XDR could not be decoded.
   */
  txResultCode: string
  /** Zero-based index of the operation that failed, when it can be identified. */
  failedOperationIndex?: number
  /**
   * Operation-level result code, e.g. `"invokeHostFunctionTrapped"`,
   * `"invokeHostFunctionEntryArchived"`, `"opNoAccount"`.
   */
  operationResultCode?: string
  /**
   * Contract error decoded from the diagnostic events, when present, formatted
   * like the Soroban host: `"Error(Contract, #3)"`, `"Error(WasmVm, #6)"`.
   */
  contractError?: string
  /** Readable strings decoded from the transaction's diagnostic events. */
  diagnosticMessages: string[]
  /** Best-effort single-line summary of why the transaction failed. */
  message: string
}

/** A value that is either an already-decoded XDR object or its base64 string. */
type MaybeXdr<T> = T | string

/**
 * The subset of an RPC `GetTransactionResponse` that {@link parseTransactionFailure}
 * reads. Accepts both decoded XDR objects (as returned by
 * `rpc.Server.getTransaction`) and raw base64 strings (as found in fixtures or
 * the `RawGetTransactionResponse`).
 */
export interface ParsableTransactionResponse {
  status: rpc.Api.GetTransactionStatus | string
  resultXdr?: MaybeXdr<xdr.TransactionResult>
  diagnosticEventsXdr?: MaybeXdr<xdr.DiagnosticEvent>[]
}

interface ScErrorNative {
  type: string
  code: number | string
}

const SUCCESS_CODE = /success$/i

function decodeResult(
  value: MaybeXdr<xdr.TransactionResult> | undefined,
): xdr.TransactionResult | undefined {
  if (value == null) return undefined
  try {
    return typeof value === 'string' ? xdr.TransactionResult.fromXDR(value, 'base64') : value
  } catch {
    return undefined
  }
}

function decodeEvents(list: MaybeXdr<xdr.DiagnosticEvent>[] | undefined): xdr.DiagnosticEvent[] {
  if (!list || list.length === 0) return []
  const out: xdr.DiagnosticEvent[] = []
  for (const entry of list) {
    try {
      out.push(typeof entry === 'string' ? xdr.DiagnosticEvent.fromXDR(entry, 'base64') : entry)
    } catch {
      // Skip an undecodable event rather than failing the whole parse.
    }
  }
  return out
}

function isScErrorNative(value: unknown): value is ScErrorNative {
  return typeof value === 'object' && value !== null && 'type' in value && 'code' in value
}

function formatScError(err: ScErrorNative): string {
  const type = err.type.charAt(0).toUpperCase() + err.type.slice(1)
  const code = typeof err.code === 'number' ? `#${err.code}` : String(err.code)
  return `Error(${type}, ${code})`
}

function stringifyNative(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.map(stringifyNative).filter(Boolean).join('; ')
  }
  if (isScErrorNative(value)) return formatScError(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function safeNative(value: xdr.ScVal): unknown {
  try {
    return scValToNative(value)
  } catch {
    return undefined
  }
}

/** Finds the first primitive string within a native value (possibly nested). */
function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item)
      if (found) return found
    }
  }
  return undefined
}

function parseOperationResults(result: xdr.TransactionResult): {
  failedOperationIndex?: number
  operationResultCode?: string
} {
  let opResults: xdr.OperationResult[] | undefined
  try {
    opResults = result.result().results()
  } catch {
    // Result arm carries no per-operation results (e.g. txInsufficientFee).
    return {}
  }
  // Some arms (txInsufficientFee, txBadSeq, …) return `undefined` rather than
  // throwing when asked for `results()`.
  if (!Array.isArray(opResults)) return {}

  for (let index = 0; index < opResults.length; index++) {
    const opResult = opResults[index]
    const outerCode = opResult.switch().name

    if (outerCode !== 'opInner') {
      if (!SUCCESS_CODE.test(outerCode)) {
        return { failedOperationIndex: index, operationResultCode: outerCode }
      }
      continue
    }

    try {
      const inner = opResult.tr().value() as { switch(): { name: string } }
      const innerCode = inner.switch().name
      if (!SUCCESS_CODE.test(innerCode)) {
        return { failedOperationIndex: index, operationResultCode: innerCode }
      }
    } catch {
      return {
        failedOperationIndex: index,
        operationResultCode: opResult.tr().switch().name,
      }
    }
  }

  return {}
}

function parseDiagnostics(events: xdr.DiagnosticEvent[]): {
  diagnosticMessages: string[]
  contractError?: string
  errorMessage?: string
} {
  const diagnosticMessages: string[] = []
  let contractError: string | undefined
  let errorMessage: string | undefined

  for (const event of events) {
    let v0: xdr.ContractEventV0
    try {
      v0 = event.event().body().v0()
    } catch {
      continue
    }

    const topics = v0.topics().map(safeNative)
    const data = safeNative(v0.data())

    const head = topics.map(stringifyNative).filter(Boolean).join(', ')
    const body = stringifyNative(data)
    const rendered = head && body ? `${head}: ${body}` : head || body
    if (rendered) diagnosticMessages.push(rendered)

    // The Soroban host emits an `error` diagnostic topic on failure, with the
    // contract error as a second topic and a message string in the data.
    if (topics[0] === 'error') {
      const scError = topics.find(isScErrorNative)
      if (scError && !contractError) contractError = formatScError(scError)
      errorMessage = errorMessage ?? firstString(data)
    }
  }

  return { diagnosticMessages, contractError, errorMessage }
}

function buildMessage(params: {
  txResultCode: string
  failedOperationIndex?: number
  operationResultCode?: string
  contractError?: string
  errorMessage?: string
}): string {
  const { txResultCode, failedOperationIndex, operationResultCode, contractError, errorMessage } =
    params

  if (errorMessage) {
    return contractError && !errorMessage.includes(contractError)
      ? `${contractError}: ${errorMessage}`
      : errorMessage
  }
  if (contractError) {
    return `Contract call reverted with ${contractError}`
  }
  if (operationResultCode) {
    const at = failedOperationIndex === undefined ? '' : ` (operation ${failedOperationIndex})`
    return `Transaction failed on-chain: ${operationResultCode}${at}`
  }
  if (txResultCode !== 'unknown') {
    return `Transaction failed on-chain: ${txResultCode}`
  }
  return 'Transaction failed on-chain'
}

/**
 * Decodes a failed transaction response into a structured {@link OnchainError}.
 *
 * Returns `undefined` when `response.status` is not `FAILED` — a successful or
 * not-yet-found transaction has no failure to describe. For a `FAILED`
 * response it always returns an object; fields that cannot be decoded are
 * simply omitted and `message` falls back to the most specific code available.
 *
 * @example
 * ```ts
 * const tx = await server.getTransaction(hash)
 * const onchain = parseTransactionFailure(tx)
 * if (onchain) console.error(onchain.message) // "Error(Contract, #3): ..."
 * ```
 */
export function parseTransactionFailure(
  response: ParsableTransactionResponse,
): OnchainError | undefined {
  const failed =
    response.status === rpc.Api.GetTransactionStatus.FAILED || response.status === 'FAILED'
  if (!failed) return undefined

  const result = decodeResult(response.resultXdr)
  const events = decodeEvents(response.diagnosticEventsXdr)

  let txResultCode = 'unknown'
  let opInfo: { failedOperationIndex?: number; operationResultCode?: string } = {}
  if (result) {
    try {
      txResultCode = result.result().switch().name
    } catch {
      // keep 'unknown'
    }
    opInfo = parseOperationResults(result)
  }

  const { diagnosticMessages, contractError, errorMessage } = parseDiagnostics(events)

  return {
    txResultCode,
    ...(opInfo.failedOperationIndex === undefined
      ? {}
      : { failedOperationIndex: opInfo.failedOperationIndex }),
    ...(opInfo.operationResultCode ? { operationResultCode: opInfo.operationResultCode } : {}),
    ...(contractError ? { contractError } : {}),
    diagnosticMessages,
    message: buildMessage({ txResultCode, ...opInfo, contractError, errorMessage }),
  }
}
