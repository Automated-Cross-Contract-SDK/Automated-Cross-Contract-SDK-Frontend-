import { Networks } from '@stellar/stellar-sdk'

/**
 * Reads a Vite env var, falling back when it is unset (or when
 * `import.meta.env` is unavailable, e.g. in a non-Vite test runner).
 */
function getEnvVariable(key: string, fallback: string): string {
  try {
    const value = import.meta.env[key]
    return typeof value === 'string' && value.length > 0 ? value : fallback
  } catch (err) {
    console.warn(`Failed to read env var ${key}, using fallback:`, err)
    return fallback
  }
}

/** RPC endpoint the example boots with. */
export const DEFAULT_RPC_URL = getEnvVariable('VITE_RPC_URL', 'https://soroban-testnet.stellar.org')

/** Network passphrase the example boots with. */
export const DEFAULT_NETWORK_PASSPHRASE = getEnvVariable(
  'VITE_NETWORK_PASSPHRASE',
  Networks.TESTNET,
)

/** Contract the sample `withdraw` call targets — point this at your own deployment. */
export const CONTRACT_ID = getEnvVariable(
  'VITE_CONTRACT_ID',
  'CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q',
)

/**
 * Opt-in switch for the `app.use(SorobanResurrectPlugin, ...)` variant. When
 * `false`, the example only demonstrates the `useSorobanResurrect` composable
 * and `App.vue` hides the plugin mode instead of failing in
 * `injectSorobanResurrect()`.
 */
export const USE_PLUGIN = getEnvVariable('VITE_USE_PLUGIN', 'false') === 'true'

/** Boot into the Custom preset when an explicit endpoint/passphrase was supplied. */
export const HAS_ENV_OVERRIDE = Boolean(
  import.meta.env.VITE_RPC_URL || import.meta.env.VITE_NETWORK_PASSPHRASE,
)

/** Identifier of the network selected in the picker. */
export type NetworkId = 'testnet' | 'mainnet' | 'futurenet' | 'custom'

/** The pair of values every `SorobanResurrect` instance needs. */
export interface NetworkConfig {
  rpcUrl: string
  networkPassphrase: string
}

const NETWORK_PRESETS: Record<Exclude<NetworkId, 'custom'>, NetworkConfig & { label: string }> = {
  testnet: {
    label: 'Testnet',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: Networks.TESTNET,
  },
  mainnet: {
    label: 'Mainnet',
    rpcUrl: 'https://mainnet.sorobanrpc.com',
    networkPassphrase: Networks.PUBLIC,
  },
  futurenet: {
    label: 'Futurenet',
    rpcUrl: 'https://rpc-futurenet.stellar.org',
    networkPassphrase: Networks.FUTURENET,
  },
}

/** Preset options rendered by `NetworkSelector.vue`. */
export const NETWORK_OPTIONS = (Object.keys(NETWORK_PRESETS) as Exclude<NetworkId, 'custom'>[]).map(
  (id) => ({ id, ...NETWORK_PRESETS[id] }),
)

/**
 * Passphrases offered for the Custom preset. The SDK rejects unknown
 * passphrases outright (`resolveConfig` validates against the known Stellar
 * networks), so the picker only offers values that are guaranteed to work.
 */
export const PASSPHRASE_OPTIONS = [
  { label: 'Testnet', value: Networks.TESTNET },
  { label: 'Mainnet', value: Networks.PUBLIC },
  { label: 'Futurenet', value: Networks.FUTURENET },
]

/** Initial picker state — Custom when `VITE_RPC_URL` / `VITE_NETWORK_PASSPHRASE` are set. */
export const INITIAL_NETWORK: { id: NetworkId; custom: NetworkConfig } = {
  id: HAS_ENV_OVERRIDE ? 'custom' : 'testnet',
  custom: {
    rpcUrl: DEFAULT_RPC_URL,
    networkPassphrase:
      PASSPHRASE_OPTIONS.find((option) => option.value === DEFAULT_NETWORK_PASSPHRASE)?.value ??
      Networks.TESTNET,
  },
}

/** True when `value` is a URL the SDK will accept as `rpcUrl`. */
export function isValidRpcUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Resolves the picker selection into a config the SDK accepts. */
export function resolveNetworkConfig(id: NetworkId, custom: NetworkConfig): NetworkConfig {
  if (id === 'custom') return custom
  const { rpcUrl, networkPassphrase } = NETWORK_PRESETS[id]
  return { rpcUrl, networkPassphrase }
}
