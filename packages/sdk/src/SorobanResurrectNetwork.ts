import { SorobanResurrect } from './SorobanResurrect.js'
import type { SorobanResurrectConfig } from './types.js'

/**
 * Well-known Stellar/Soroban network identifiers.
 *
 * Use these with {@link SorobanResurrectNetwork.create} to instantiate the SDK
 * pre-configured for a specific network without having to look up RPC URLs or
 * network passphrases manually.
 */
export type SorobanNetworkName = 'testnet' | 'mainnet' | 'futurenet'

/** Pre-configured RPC URL and network passphrase for a well-known network. */
export interface SorobanNetworkPreset {
  /** Soroban JSON-RPC endpoint URL. */
  rpcUrl: string
  /** Network passphrase used when signing and submitting transactions. */
  networkPassphrase: string
  /** Human-readable display name. */
  displayName: string
}

/**
 * Pre-configured network presets for well-known Stellar/Soroban networks.
 * Each entry contains the canonical RPC URL and network passphrase.
 */
export const NETWORK_PRESETS: Record<SorobanNetworkName, SorobanNetworkPreset> = {
  testnet: {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    displayName: 'Testnet',
  },
  mainnet: {
    rpcUrl: 'https://mainnet.stellar.validationcloud.io/v1/XCSmR1pP5PR9HBMcUxnHEHaZiVlFpF8A',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    displayName: 'Mainnet',
  },
  futurenet: {
    rpcUrl: 'https://rpc-futurenet.stellar.org',
    networkPassphrase: 'Test SDF Future Network ; September 2015',
    displayName: 'Futurenet',
  },
}

/**
 * Utility class for instantiating and switching the Soroban-Resurrect SDK
 * across well-known Stellar networks (Testnet, Mainnet, Futurenet) or a
 * custom RPC endpoint.
 *
 * @example — Pre-configured for Testnet
 * ```ts
 * const sr = SorobanResurrectNetwork.testnet()
 * ```
 *
 * @example — Pre-configured for Mainnet
 * ```ts
 * const sr = SorobanResurrectNetwork.mainnet()
 * ```
 *
 * @example — Custom RPC endpoint
 * ```ts
 * const sr = SorobanResurrectNetwork.custom({
 *   rpcUrl: 'https://my-rpc.example.com',
 *   networkPassphrase: 'My Private Network ; 2024',
 * })
 * ```
 *
 * @example — Switch networks at runtime
 * ```ts
 * let sr = SorobanResurrectNetwork.testnet()
 * // Later, switch to mainnet:
 * sr = SorobanResurrectNetwork.create('mainnet', { pollIntervalMs: 2000 })
 * ```
 */
export class SorobanResurrectNetwork {
  /**
   * Creates a `SorobanResurrect` instance pre-configured for a well-known
   * Stellar/Soroban network.
   *
   * @param network - One of `'testnet'`, `'mainnet'`, or `'futurenet'`.
   * @param overrides - Optional additional config overrides (e.g. polling settings).
   * @returns A fully configured `SorobanResurrect` instance.
   */
  static create(
    network: SorobanNetworkName,
    overrides?: Partial<Omit<SorobanResurrectConfig, 'rpcUrl' | 'networkPassphrase'>>,
  ): SorobanResurrect {
    const preset = NETWORK_PRESETS[network]
    return new SorobanResurrect({
      rpcUrl: preset.rpcUrl,
      networkPassphrase: preset.networkPassphrase,
      ...overrides,
    })
  }

  /**
   * Creates a `SorobanResurrect` instance pre-configured for **Testnet**.
   *
   * - RPC: `https://soroban-testnet.stellar.org`
   * - Passphrase: `Test SDF Network ; September 2015`
   *
   * @param overrides - Optional config overrides.
   */
  static testnet(
    overrides?: Partial<Omit<SorobanResurrectConfig, 'rpcUrl' | 'networkPassphrase'>>,
  ): SorobanResurrect {
    return SorobanResurrectNetwork.create('testnet', overrides)
  }

  /**
   * Creates a `SorobanResurrect` instance pre-configured for **Mainnet**.
   *
   * - RPC: `https://mainnet.stellar.validationcloud.io/...`
   * - Passphrase: `Public Global Stellar Network ; September 2015`
   *
   * @param overrides - Optional config overrides.
   */
  static mainnet(
    overrides?: Partial<Omit<SorobanResurrectConfig, 'rpcUrl' | 'networkPassphrase'>>,
  ): SorobanResurrect {
    return SorobanResurrectNetwork.create('mainnet', overrides)
  }

  /**
   * Creates a `SorobanResurrect` instance pre-configured for **Futurenet**.
   *
   * - RPC: `https://rpc-futurenet.stellar.org`
   * - Passphrase: `Test SDF Future Network ; September 2015`
   *
   * @param overrides - Optional config overrides.
   */
  static futurenet(
    overrides?: Partial<Omit<SorobanResurrectConfig, 'rpcUrl' | 'networkPassphrase'>>,
  ): SorobanResurrect {
    return SorobanResurrectNetwork.create('futurenet', overrides)
  }

  /**
   * Creates a `SorobanResurrect` instance configured for a **custom** RPC
   * endpoint and network passphrase. Use this for private networks, local
   * development nodes, or alternative RPC providers.
   *
   * @param config - Full SDK configuration (rpcUrl required).
   */
  static custom(config: SorobanResurrectConfig): SorobanResurrect {
    return new SorobanResurrect(config)
  }

  /**
   * Returns the preset configuration for a given well-known network
   * without creating an SDK instance. Useful for inspecting RPC URLs
   * and passphrases programmatically.
   *
   * @param network - The network name to look up.
   * @returns The {@link SorobanNetworkPreset} for that network.
   */
  static getPreset(network: SorobanNetworkName): SorobanNetworkPreset {
    return NETWORK_PRESETS[network]
  }

  /**
   * Returns all available network presets as an array, suitable for
   * populating a network-selector UI.
   */
  static listPresets(): Array<SorobanNetworkPreset & { name: SorobanNetworkName }> {
    return (Object.keys(NETWORK_PRESETS) as SorobanNetworkName[]).map((name) => ({
      name,
      ...NETWORK_PRESETS[name],
    }))
  }
}
