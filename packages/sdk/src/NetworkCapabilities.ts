import type { ISorobanRpcClient } from './RpcClient.js'

/** Minimum Stellar protocol version that supports Soroban footprint restore. */
export const MIN_RESTORE_PROTOCOL_VERSION = 20

export type NetworkCapabilityStatus = 'supported' | 'unsupported' | 'unknown'
export type NetworkCompatibilityStatus = 'compatible' | 'incompatible' | 'unknown'

export interface NetworkCapabilityCheck {
  status: NetworkCapabilityStatus
  message: string
}

export interface SorobanNetworkCapabilityReport {
  /** Overall assessment; unknown means the available evidence was incomplete. */
  status: NetworkCompatibilityStatus
  /** Convenience value: null when compatibility could not be determined. */
  isCompatible: boolean | null
  configuredNetworkPassphrase: string
  rpcNetworkPassphrase?: string
  rpcVersion?: string
  protocolVersion?: number
  requiredRpcMethods: {
    status: NetworkCapabilityStatus
    available: string[]
    missing: string[]
  }
  network: NetworkCapabilityCheck
  restoreProtocol: NetworkCapabilityCheck
  /** Actionable details for mismatches, unsupported endpoints, and failed probes. */
  messages: string[]
}

const REQUIRED_RPC_METHODS = [
  'simulateTransaction',
  'sendTransaction',
  'getTransaction',
  'getAccount',
  'getLedgerEntries',
  'getLatestLedger',
] as const

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

/**
 * Checks that the configured RPC client has the SDK's required methods,
 * targets the configured Stellar network, and supports protocol-level
 * footprint restoration. Network/version methods are optional on custom
 * clients; if unavailable, the report explicitly returns `unknown`.
 */
export async function checkNetworkCapabilities(
  client: ISorobanRpcClient,
  configuredNetworkPassphrase: string,
): Promise<SorobanNetworkCapabilityReport> {
  const messages: string[] = []
  const available = REQUIRED_RPC_METHODS.filter((method) => typeof client[method] === 'function')
  const missing = REQUIRED_RPC_METHODS.filter((method) => !available.includes(method))
  const requiredRpcMethods: SorobanNetworkCapabilityReport['requiredRpcMethods'] = {
    status: missing.length === 0 ? 'supported' : 'unsupported',
    available: [...available],
    missing: [...missing],
  }
  if (missing.length > 0) {
    messages.push(`RPC client is missing required methods: ${missing.join(', ')}.`)
  }

  let network: NetworkCapabilityCheck
  let rpcNetworkPassphrase: string | undefined
  if (!client.getNetwork) {
    network = {
      status: 'unknown',
      message: 'RPC client does not expose getNetwork(); add this method to verify its network passphrase.',
    }
  } else {
    try {
      const response = asObject(await client.getNetwork())
      const passphrase = response?.passphrase
      if (typeof passphrase !== 'string' || passphrase.length === 0) {
        network = {
          status: 'unknown',
          message: 'RPC getNetwork() returned no passphrase; check that the endpoint supports the Soroban RPC API.',
        }
      } else {
        rpcNetworkPassphrase = passphrase
        network =
          passphrase === configuredNetworkPassphrase
            ? { status: 'supported', message: 'RPC network passphrase matches the configured network.' }
            : {
                status: 'unsupported',
                message:
                  'RPC network passphrase does not match the configured network; correct the RPC URL or networkPassphrase.',
              }
      }
    } catch (error) {
      network = {
        status: 'unknown',
        message: `RPC getNetwork() failed: ${errorMessage(error)}. Verify the endpoint is reachable and supports Soroban RPC.`,
      }
    }
  }
  if (network.status !== 'supported') messages.push(network.message)

  let restoreProtocol: NetworkCapabilityCheck
  let rpcVersion: string | undefined
  let protocolVersion: number | undefined
  if (!client.getVersionInfo) {
    restoreProtocol = {
      status: 'unknown',
      message:
        'RPC client does not expose getVersionInfo(); implement it to verify support for protocol 20+ footprint restoration.',
    }
  } else {
    try {
      const response = asObject(await client.getVersionInfo())
      const rawProtocolVersion = response?.protocolVersion
      const parsedProtocolVersion =
        typeof rawProtocolVersion === 'number'
          ? rawProtocolVersion
          : typeof rawProtocolVersion === 'string' && rawProtocolVersion.trim() !== ''
            ? Number(rawProtocolVersion)
            : Number.NaN
      if (typeof response?.version === 'string') rpcVersion = response.version
      if (Number.isInteger(parsedProtocolVersion) && parsedProtocolVersion >= 0) {
        protocolVersion = parsedProtocolVersion
        restoreProtocol =
          protocolVersion >= MIN_RESTORE_PROTOCOL_VERSION
            ? {
                status: 'supported',
                message: `RPC protocol ${protocolVersion} supports footprint restoration.`,
              }
            : {
                status: 'unsupported',
                message:
                  `RPC protocol ${protocolVersion} is below the required protocol ` +
                  `${MIN_RESTORE_PROTOCOL_VERSION}; upgrade or select a compatible network.`,
              }
      } else {
        restoreProtocol = {
          status: 'unknown',
          message: 'RPC getVersionInfo() returned no valid protocolVersion; protocol support could not be verified.',
        }
      }
    } catch (error) {
      restoreProtocol = {
        status: 'unknown',
        message: `RPC getVersionInfo() failed: ${errorMessage(error)}. Verify the endpoint supports getVersionInfo().`,
      }
    }
  }
  if (restoreProtocol.status !== 'supported') messages.push(restoreProtocol.message)

  const checks = [requiredRpcMethods.status, network.status, restoreProtocol.status]
  const status: NetworkCompatibilityStatus = checks.includes('unsupported')
    ? 'incompatible'
    : checks.includes('unknown')
      ? 'unknown'
      : 'compatible'

  return {
    status,
    isCompatible: status === 'compatible' ? true : status === 'incompatible' ? false : null,
    configuredNetworkPassphrase,
    ...(rpcNetworkPassphrase ? { rpcNetworkPassphrase } : {}),
    ...(rpcVersion ? { rpcVersion } : {}),
    ...(protocolVersion !== undefined ? { protocolVersion } : {}),
    requiredRpcMethods,
    network,
    restoreProtocol,
    messages,
  }
}
