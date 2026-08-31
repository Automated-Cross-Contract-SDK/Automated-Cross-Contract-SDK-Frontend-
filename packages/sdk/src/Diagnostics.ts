/**
 * Failed-transaction diagnostics parsing.
 *
 * When `waitForTransaction` reports `FAILED`, the raw
 * `GetTransactionResponse` still carries enough information to explain what
 * went wrong on-chain — `DiagnosticEvent`s and the transaction result XDR.
 * This module turns that raw XDR into a lean {@link TxDiagnostics} object that
 * is attached to {@link ResurrectResult.diagnostics}.
 *
 * All parsing is best-effort and defensive: a decode failure on any single
 * field degrades gracefully to "not available" rather than throwing.
 */

import { rpc, xdr, scValToNative } from '@stellar/stellar-sdk'
import type { TxDiagnostics } from './types.js'

/**
 * Renders a single `xdr.ScVal` as a short human-readable string.
 * Falls back through native conversion → discriminant name → placeholder.
 */
function scValToString(value: xdr.ScVal): string {
  try {
    const native = scValToNative(value)
    if (typeof native === 'string') return native
    if (typeof native === 'bigint') return native.toString()
    if (native !== undefined && native !== null) {
      const json = JSON.stringify(native, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
      if (json !== undefined) return json
    }
  } catch {
    /* fall through to discriminant name */
  }
  try {
    return value.switch().name
  } catch {
    return '<scval>'
  }
}

/**
 * Summarises one `xdr.DiagnosticEvent` as `"[ok|fail] topics=[...] data=..."`.
 */
function stringifyDiagnosticEvent(ev: xdr.DiagnosticEvent): string {
  try {
    const inSuccess = ev.inSuccessfulContractCall()
    const body = ev.event().body().v0()
    const topics = body
      .topics()
      .map((t) => scValToString(t))
      .join(', ')
    const data = scValToString(body.data())
    return `[${inSuccess ? 'ok' : 'fail'}] topics=[${topics}] data=${data}`
  } catch {
    try {
      return ev.toXDR('base64')
    } catch {
      return '<diagnostic-event>'
    }
  }
}

/** Coerces a raw diagnostic-event entry (object or base64 string) to `xdr.DiagnosticEvent`. */
function toDiagnosticEvent(raw: unknown): xdr.DiagnosticEvent | undefined {
  if (raw == null) return undefined
  if (typeof raw === 'string') {
    try {
      return xdr.DiagnosticEvent.fromXDR(raw, 'base64')
    } catch {
      return undefined
    }
  }
  if (typeof (raw as xdr.DiagnosticEvent).toXDR === 'function') {
    return raw as xdr.DiagnosticEvent
  }
  return undefined
}

/** Coerces a raw result-XDR entry (object or base64 string) to `xdr.TransactionResult`. */
function toTransactionResult(raw: unknown): xdr.TransactionResult | undefined {
  if (raw == null) return undefined
  if (typeof raw === 'string') {
    try {
      return xdr.TransactionResult.fromXDR(raw, 'base64')
    } catch {
      return undefined
    }
  }
  if (typeof (raw as xdr.TransactionResult).result === 'function') {
    return raw as xdr.TransactionResult
  }
  return undefined
}

/**
 * Walks an operation-result XDR node, collecting result-code discriminant
 * names. Handles the common `opInner` → inner op result nesting.
 */
function collectOpResultCodes(opResult: xdr.OperationResult): string[] {
  const codes: string[] = []
  try {
    const outer = opResult.switch().name
    codes.push(outer)
    if (outer === 'opInner') {
      const inner = opResult.tr()
      // `tr()` discriminant names the op *type*; the meaningful result code is
      // one level deeper for Soroban ops.
      const trName = inner.switch().name
      if (trName === 'invokeHostFunction') {
        codes.push(inner.invokeHostFunctionResult().switch().name)
      } else if (trName === 'restoreFootprint') {
        codes.push(inner.restoreFootprintResult().switch().name)
      } else if (trName === 'extendFootprintTtl') {
        codes.push(inner.extendFootprintTtlResult().switch().name)
      } else {
        codes.push(trName)
      }
    }
  } catch {
    /* partial decode — return what we have */
  }
  return codes
}

/**
 * Parses on-chain diagnostics from a failed transaction response.
 *
 * @param response - The terminal `GetTransactionResponse` from
 *   `waitForTransaction` / `getTransaction`.
 * @returns A {@link TxDiagnostics} object, or `undefined` when the response is
 *   a success, is missing, or carries no decodable diagnostic information.
 */
export function parseTransactionDiagnostics(
  response: rpc.Api.GetTransactionResponse | null | undefined,
): TxDiagnostics | undefined {
  if (!response) return undefined
  if (response.status === rpc.Api.GetTransactionStatus.SUCCESS) return undefined

  const anyResp = response as unknown as Record<string, unknown>

  const events: string[] = []
  const rawEventsXdr: string[] = []
  let revertReason: string | undefined

  const rawDiagEvents =
    (anyResp.diagnosticEventsXdr as unknown[] | undefined) ??
    (anyResp.diagnosticEvents as unknown[] | undefined) ??
    []

  for (const rawEv of rawDiagEvents) {
    const ev = toDiagnosticEvent(rawEv)
    if (!ev) {
      if (typeof rawEv === 'string') {
        rawEventsXdr.push(rawEv)
        events.push(rawEv)
      }
      continue
    }
    try {
      rawEventsXdr.push(ev.toXDR('base64'))
    } catch {
      /* ignore */
    }
    const text = stringifyDiagnosticEvent(ev)
    events.push(text)
    if (!revertReason && /error|panic|trap|revert|abort|failed/i.test(text)) {
      revertReason = text
    }
  }

  let failedOpIndex: number | undefined
  const resultCodes: string[] = []

  const txResult = toTransactionResult(anyResp.resultXdr ?? anyResp.returnValue)
  if (txResult) {
    try {
      const r = txResult.result()
      resultCodes.push(r.switch().name)
      let opResults: xdr.OperationResult[] | undefined
      try {
        opResults = r.results() as xdr.OperationResult[]
      } catch {
        opResults = undefined
      }
      if (Array.isArray(opResults)) {
        opResults.forEach((op, idx) => {
          const codes = collectOpResultCodes(op)
          resultCodes.push(...codes)
          const failed = codes.some((c) => c !== 'opInner' && !/Success$/i.test(c))
          if (failedOpIndex === undefined && failed) {
            failedOpIndex = idx
          }
        })
      }
    } catch {
      /* result XDR not fully decodable */
    }
  }

  if (events.length === 0 && rawEventsXdr.length === 0 && resultCodes.length === 0) {
    return undefined
  }

  return {
    events,
    ...(failedOpIndex !== undefined ? { failedOpIndex } : {}),
    ...(revertReason ? { revertReason } : {}),
    ...(resultCodes.length > 0 ? { resultCodes } : {}),
    ...(rawEventsXdr.length > 0 ? { rawEventsXdr } : {}),
  }
}
