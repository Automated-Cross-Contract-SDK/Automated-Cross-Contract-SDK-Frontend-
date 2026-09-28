/**
 * @file ContractScan.ts
 *
 * Account / contract-level archived-entry scanning (#239).
 *
 * `detectArchivedKeys` (in `Archiver.ts`) answers "which footprint entries
 * of *this transaction* are archived?" — it needs a fully built transaction.
 * There was no way to ask the broader question:
 *
 * > "Which of this contract's data entries are archived or expiring soon?"
 *
 * without constructing a dummy transaction. This module fills that gap:
 *
 * - {@link getExpiringEntriesForContract} — scans a contract's instance,
 *   Wasm code, and (caller-supplied) storage entries, returning each with
 *   its remaining TTL and archived status.
 * - {@link getExpiringEntriesForAccount} — the account variant: scans the
 *   account entry plus its trustlines by presence on-chain.
 *
 * Both reuse {@link queryLedgerTTL}, which already fetches ledger entries
 * in chunks of 50, so arbitrarily large key sets are handled.
 */

import { Address, Asset, StrKey, xdr } from '@stellar/stellar-sdk'
import type { ISorobanRpcClient } from './RpcClient.js'
import type { ArchivedLedgerEntry } from './types.js'
import { asXdrBase64, type XdrBase64 } from './branded-types.js'
import { queryLedgerTTL, type LedgerEntryTTLInfo } from './TTLHelpers.js'
import { DEFAULT_EXPIRING_SOON_LEDGERS } from './ttl.js'

// ---------------------------------------------------------------------------
// Contract scan
// ---------------------------------------------------------------------------

/** Options for {@link getExpiringEntriesForContract}. */
export interface ContractScanOptions {
  /**
   * Contract storage keys (the `ScVal` used as the map key in
   * `env.storage().persistent().set(key, ...)`) to include in the scan.
   * The SDK cannot enumerate a contract's storage on its own — pass the
   * keys your contract is known to use.
   */
  storageKeys?: xdr.ScVal[]
  /** Durability bucket for {@link storageKeys} (default `'persistent'`). */
  durability?: 'persistent' | 'temporary'
  /** Include the contract instance entry (default `true`). */
  includeInstance?: boolean
  /**
   * Include the contract's Wasm code entry (default `true`). Requires one
   * extra `getLedgerEntries` call to read the instance and recover the
   * Wasm hash; silently skipped when the instance is missing or the
   * contract is not Wasm-backed.
   */
  includeCode?: boolean
  /**
   * TTL threshold, in ledgers: an entry with `ttlLedgers` at or below this
   * (and not yet archived) is reported in `expiringSoon`
   * (default {@link DEFAULT_EXPIRING_SOON_LEDGERS}).
   */
  expiringWithinLedgers?: number
}

/** Result of {@link getExpiringEntriesForContract}. */
export interface ContractScanResult {
  /** The contract that was scanned (StrKey `C...` form). */
  contractId: string
  /** TTL info for every scanned key, in scan order. */
  entries: LedgerEntryTTLInfo[]
  /** Entries that are live but within `expiringWithinLedgers` of expiry. */
  expiringSoon: LedgerEntryTTLInfo[]
  /** Entries that are already archived, as `ArchivedLedgerEntry` objects. */
  archived: ArchivedLedgerEntry[]
  /** Ledger sequence at query time. */
  currentLedger: number
  /** `Date.now()` at query time. */
  queriedAt: number
}

function durabilityOf(kind: 'persistent' | 'temporary'): xdr.ContractDataDurability {
  return kind === 'temporary'
    ? xdr.ContractDataDurability.temporary()
    : xdr.ContractDataDurability.persistent()
}

function contractDataKey(
  contractId: string,
  key: xdr.ScVal,
  durability: 'persistent' | 'temporary',
): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key,
      durability: durabilityOf(durability),
    }),
  )
}

/** The instance entry always lives in the persistent bucket. */
function contractInstanceKey(contractId: string): xdr.LedgerKey {
  return contractDataKey(contractId, xdr.ScVal.scvLedgerKeyContractInstance(), 'persistent')
}

/**
 * Reads the contract instance entry and, if it is Wasm-backed, returns the
 * `LedgerKey` for its code entry. Returns `undefined` on any miss so the
 * scan degrades gracefully.
 */
async function tryContractCodeKey(
  server: ISorobanRpcClient,
  contractId: string,
): Promise<xdr.LedgerKey | undefined> {
  try {
    const res = await server.getLedgerEntries(contractInstanceKey(contractId))
    const entry = res.entries?.[0]
    if (!entry) return undefined
    const instance = entry.val.contractData().val().instance()
    const exec = instance.executable()
    if (exec.switch().name !== 'contractExecutableWasm') return undefined
    return xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: exec.wasmHash() }))
  } catch {
    return undefined
  }
}

/**
 * Scans a contract's ledger entries and reports which are archived or
 * expiring soon — without building a transaction.
 *
 * @param server     - Soroban RPC client.
 * @param contractId - Contract id in StrKey (`C...`) form.
 * @param opts       - See {@link ContractScanOptions}.
 */
export async function getExpiringEntriesForContract(
  server: ISorobanRpcClient,
  contractId: string,
  opts: ContractScanOptions = {},
): Promise<ContractScanResult> {
  if (!StrKey.isValidContract(contractId)) {
    throw new Error(`getExpiringEntriesForContract: invalid contract id "${contractId}"`)
  }

  const {
    storageKeys = [],
    durability = 'persistent',
    includeInstance = true,
    includeCode = true,
    expiringWithinLedgers = DEFAULT_EXPIRING_SOON_LEDGERS,
  } = opts

  const keys: xdr.LedgerKey[] = []
  if (includeInstance) keys.push(contractInstanceKey(contractId))
  if (includeCode) {
    const codeKey = await tryContractCodeKey(server, contractId)
    if (codeKey) keys.push(codeKey)
  }
  for (const sk of storageKeys) keys.push(contractDataKey(contractId, sk, durability))

  const { entries, currentLedger, queriedAt } = await queryLedgerTTL(server, keys)

  const expiringSoon = entries.filter((e) => !e.isArchived && e.ttlLedgers <= expiringWithinLedgers)
  const archived: ArchivedLedgerEntry[] = entries
    .filter((e) => e.isArchived)
    .map((e) => ({
      key: xdr.LedgerKey.fromXDR(e.keyBase64, 'base64'),
      keyBase64: e.keyBase64,
    }))

  return { contractId, entries, expiringSoon, archived, currentLedger, queriedAt }
}

// ---------------------------------------------------------------------------
// Account scan
// ---------------------------------------------------------------------------

/** Options for {@link getExpiringEntriesForAccount}. */
export interface AccountScanOptions {
  /**
   * Trustline assets to check for the account (e.g. derived from Horizon
   * balances). The native asset is ignored — it has no trustline entry.
   */
  trustlineAssets?: Asset[]
  /** Include the account entry itself in the scan (default `true`). */
  includeAccount?: boolean
}

/** Presence status for a single classic ledger entry. */
export interface ClassicEntryStatus {
  /** Base64 XDR of the ledger key. */
  keyBase64: XdrBase64
  /** What kind of entry this is. */
  kind: 'account' | 'trustline'
  /** Human label (account id, or `CODE:ISSUER` for a trustline). */
  label: string
  /** Whether the entry currently exists on-chain. */
  exists: boolean
}

/** Result of {@link getExpiringEntriesForAccount}. */
export interface AccountScanResult {
  /** The account that was scanned (`G...`). */
  accountId: string
  /** Status for every scanned key, in scan order. */
  entries: ClassicEntryStatus[]
  /** The subset whose `exists` is `false`. */
  missing: ClassicEntryStatus[]
  /** Ledger sequence at query time. */
  currentLedger: number
  /** `Date.now()` at query time. */
  queriedAt: number
}

function accountLedgerKey(accountId: string): xdr.LedgerKey {
  return xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({
      accountId: xdr.PublicKey.publi

/* … truncated 2525 chars — edit only what you need near the top … */
