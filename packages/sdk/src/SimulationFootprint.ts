import type { xdr } from '@stellar/stellar-sdk'

export type IncompleteFootprintCondition =
  | 'unparsed-response'
  | 'missing-transaction-data'
  | 'missing-footprint'
  | 'missing-read-only-entries'
  | 'missing-read-write-entries'
  | 'empty-read-write-footprint'
  | 'unrecognized-response'
  | 'invalid-footprint'

/** Raised when an RPC simulation cannot safely provide the footprint needed for recovery. */
export class IncompleteFootprintError extends Error {
  readonly code = 'INCOMPLETE_FOOTPRINT' as const

  constructor(
    readonly condition: IncompleteFootprintCondition,
    detail: string,
  ) {
    super(`Cannot safely recover from simulation response (${condition}): ${detail}`)
    this.name = 'IncompleteFootprintError'
  }
}

export interface SimulationFootprint {
  readOnly: xdr.LedgerKey[]
  readWrite: xdr.LedgerKey[]
}

interface SimulationResponseWithFootprint {
  _parsed?: unknown
  transactionData?: {
    getFootprint?: () => unknown
  }
}

/**
 * Reads and validates the parsed footprint. Restore construction can require
 * at least one read-write key; successful simulations may legitimately have
 * an empty read-write footprint.
 */
export function readSimulationFootprint(
  response: SimulationResponseWithFootprint,
  options: { requireReadWrite?: boolean } = {},
): SimulationFootprint {
  if (response._parsed !== true) {
    throw new IncompleteFootprintError(
      'unparsed-response',
      'the RPC response has _parsed=false, so its footprint cannot be trusted.',
    )
  }

  const transactionData = response.transactionData
  if (!transactionData || typeof transactionData.getFootprint !== 'function') {
    throw new IncompleteFootprintError(
      'missing-transaction-data',
      'the response does not include usable transactionData.',
    )
  }

  let rawFootprint: unknown
  try {
    rawFootprint = transactionData.getFootprint()
  } catch (error) {
    throw new IncompleteFootprintError(
      'invalid-footprint',
      `transactionData.getFootprint() failed: ${error instanceof Error ? error.message : String(error)}.`,
    )
  }

  if (typeof rawFootprint !== 'object' || rawFootprint === null) {
    throw new IncompleteFootprintError(
      'missing-footprint',
      'transactionData did not contain a readable footprint.',
    )
  }

  const footprint = rawFootprint as {
    readOnly?: () => unknown
    readWrite?: () => unknown
  }
  if (typeof footprint.readOnly !== 'function') {
    throw new IncompleteFootprintError(
      'missing-read-only-entries',
      'the footprint does not provide readOnly entries.',
    )
  }
  if (typeof footprint.readWrite !== 'function') {
    throw new IncompleteFootprintError(
      'missing-read-write-entries',
      'the footprint does not provide readWrite entries.',
    )
  }

  let readOnly: unknown
  let readWrite: unknown
  try {
    readOnly = footprint.readOnly()
    readWrite = footprint.readWrite()
  } catch (error) {
    throw new IncompleteFootprintError(
      'invalid-footprint',
      `reading footprint entries failed: ${error instanceof Error ? error.message : String(error)}.`,
    )
  }

  if (!Array.isArray(readOnly)) {
    throw new IncompleteFootprintError(
      'missing-read-only-entries',
      'the footprint returned no valid readOnly entry list.',
    )
  }
  if (!Array.isArray(readWrite)) {
    throw new IncompleteFootprintError(
      'missing-read-write-entries',
      'the footprint returned no valid readWrite entry list.',
    )
  }
  if (options.requireReadWrite && readWrite.length === 0) {
    throw new IncompleteFootprintError(
      'empty-read-write-footprint',
      'the restore response has no read-write ledger keys to restore.',
    )
  }

  return {
    readOnly: readOnly as xdr.LedgerKey[],
    readWrite: readWrite as xdr.LedgerKey[],
  }
}
