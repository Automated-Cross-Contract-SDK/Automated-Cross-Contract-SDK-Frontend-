/**
 * Ergonomic wallet-adapter factory.
 *
 * Each wallet adapter ships as its own package with its own constructor
 * (`FreighterAdapter`, `AlbedoAdapter`, ...). `createAdapter` is a thin
 * registry over those constructors with lazy dynamic imports, so integrators
 * can instantiate any supported wallet from a single entry point without
 * juggling per-wallet imports.
 *
 * The per-package constructors remain the supported path for advanced use;
 * this factory is purely a convenience layer.
 *
 * @example
 * ```ts
 * import { createAdapter } from '@soroban-resurrect/sdk'
 *
 * const wallet = await createAdapter('freighter')
 * const sdk = new SorobanResurrect({ rpcUrl: '...' })
 * await sdk.submitWithRestore({ transaction, wallet })
 *
 * // Hardware wallets take their usual options:
 * const ledger = await createAdapter('ledger', { transport })
 * ```
 */

import type { WalletAdapter } from './types.js'
import { createLedgerAdapter, createTrezorAdapter } from './HardwareWalletAdapters.js'
import type { LedgerAdapterConfig, TrezorAdapterConfig } from './types.js'

/** Wallet identifiers understood by {@link createAdapter}. */
export type KnownWallet =
  | 'freighter'
  | 'albedo'
  | 'lobstr'
  | 'xbull'
  | 'ledger'
  | 'trezor'

/** All wallet names {@link createAdapter} accepts, for error messages and discovery. */
export const SUPPORTED_WALLETS: readonly KnownWallet[] = [
  'freighter',
  'albedo',
  'lobstr',
  'xbull',
  'ledger',
  'trezor',
] as const

interface BrowserEntry {
  kind: 'browser'
  /** npm package that exports the adapter class. */
  pkg: string
  /** Named export within that package. */
  exportName: string
}

interface HardwareEntry {
  kind: 'hardware'
  create: (opts: unknown) => WalletAdapter
}

const REGISTRY: Record<KnownWallet, BrowserEntry | HardwareEntry> = {
  freighter: {
    kind: 'browser',
    pkg: '@soroban-resurrect/adapter-freighter',
    exportName: 'FreighterAdapter',
  },
  albedo: {
    kind: 'browser',
    pkg: '@soroban-resurrect/adapter-albedo',
    exportName: 'AlbedoAdapter',
  },
  lobstr: {
    kind: 'browser',
    pkg: '@soroban-resurrect/adapter-lobstr',
    exportName: 'LobstrAdapter',
  },
  xbull: {
    kind: 'browser',
    pkg: '@soroban-resurrect/adapter-xbull',
    exportName: 'XBullAdapter',
  },
  ledger: {
    kind: 'hardware',
    create: (opts) => createLedgerAdapter((opts ?? {}) as LedgerAdapterConfig),
  },
  trezor: {
    kind: 'hardware',
    create: (opts) => createTrezorAdapter(opts as TrezorAdapterConfig),
  },
}

/**
 * Dynamic-import function used to load browser adapter packages. Injectable so
 * tests can supply a stub without the real packages being installed.
 */
export type AdapterImporter = (pkg: string) => Promise<Record<string, unknown>>

const defaultImporter: AdapterImporter = (pkg) =>
  import(/* @vite-ignore */ pkg) as Promise<Record<string, unknown>>

/** Options forwarded verbatim to the underlying adapter constructor. */
export type CreateAdapterOptions = Record<string, unknown>

/**
 * Returns `true` if `name` is a wallet {@link createAdapter} supports.
 */
export function isKnownWallet(name: string): name is KnownWallet {
  return (SUPPORTED_WALLETS as readonly string[]).includes(name.toLowerCase())
}

/**
 * Instantiates a {@link WalletAdapter} for a known wallet by name.
 *
 * Browser adapters are loaded with a lazy dynamic import so pulling in the SDK
 * does not pull in every wallet SDK. Hardware adapters (`ledger`, `trezor`)
 * are created from the in-package factories.
 *
 * @param wallet - One of {@link SUPPORTED_WALLETS} (case-insensitive).
 * @param opts - Options passed to the adapter constructor (e.g. `{ transport }`
 *   for `ledger`, the Trezor manifest for `trezor`).
 * @param importer - Advanced/testing hook to override the dynamic import.
 * @returns A ready-to-use `WalletAdapter`.
 * @throws {Error} If `wallet` is not a supported name (the message lists the
 *   supported names), or if the adapter package cannot be loaded.
 */
export async function createAdapter(
  wallet: KnownWallet | (string & {}),
  opts?: CreateAdapterOptions,
  importer: AdapterImporter = defaultImporter,
): Promise<WalletAdapter> {
  const key = String(wallet).toLowerCase()
  const entry = (REGISTRY as Record<string, BrowserEntry | HardwareEntry | undefined>)[key]

  if (!entry) {
    throw new Error(
      `createAdapter: unknown wallet "${wallet}". ` +
        `Supported wallets: ${SUPPORTED_WALLETS.join(', ')}.`,
    )
  }

  if (entry.kind === 'hardware') {
    return entry.create(opts)
  }

  let mod: Record<string, unknown>
  try {
    mod = await importer(entry.pkg)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(
      `createAdapter: failed to load "${entry.pkg}" for wallet "${key}". ` +
        `Install it as a dependency (npm i ${entry.pkg}). Original error: ${reason}`,
    )
  }

  const Ctor = (mod[entry.exportName] ?? (mod.default as Record<string, unknown> | undefined)?.[entry.exportName]) as
    | (new (opts?: unknown) => WalletAdapter)
    | undefined

  if (typeof Ctor !== 'function') {
    throw new Error(
      `createAdapter: package "${entry.pkg}" does not export "${entry.exportName}".`,
    )
  }

  return new Ctor(opts)
}
