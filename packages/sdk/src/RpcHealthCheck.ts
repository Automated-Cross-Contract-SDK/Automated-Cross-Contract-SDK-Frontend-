/**
 * Diagnostic health check for RPC endpoint configuration.
 *
 * Provides a non-mutating check for endpoint reachability and required RPC methods,
 * returning typed results suitable for support tooling and diagnostic dashboards.
 */

import type { RpcUrl } from './branded-types.js';

/**
 * Result of a single RPC method availability check.
 *
 * @public
 */
export interface RpcMethodCheckResult {
  /** Name of the RPC method (e.g., 'simulateTransaction'). */
  method: string;

  /** Whether the method is available (responded without error). */
  available: boolean;

  /** Error message if the check failed (not full error, summary only). */
  error?: string;

  /** Response time in milliseconds (if available). */
  responseTimeMs?: number;
}

/**
 * Result of an endpoint reachability check.
 *
 * @public
 */
export interface RpcEndpointCheckResult {
  /** The RPC endpoint URL that was checked. */
  endpoint: string;

  /** Whether the endpoint is reachable (no connection error). */
  reachable: boolean;

  /** HTTP status code if the endpoint responded. */
  statusCode?: number;

  /** Error message if unreachable (e.g., connection timeout). */
  error?: string;

  /** Response time in milliseconds (if reachable). */
  responseTimeMs?: number;
}

/**
 * Comprehensive RPC health check result.
 *
 * @public
 */
export interface RpcHealthCheckResult {
  /** Timestamp when the check was performed (ISO 8601). */
  timestamp: string;

  /** Overall health status. */
  healthy: boolean;

  /** Endpoint reachability check. */
  endpoint: RpcEndpointCheckResult;

  /** Results for required Soroban RPC methods. */
  requiredMethods: RpcMethodCheckResult[];

  /** Optional additional methods to check. */
  optionalMethods?: RpcMethodCheckResult[];

  /** Recommendations for next steps (if any issues detected). */
  recommendations?: string[];

  /** Summary message. */
  summary: string;
}

/**
 * Checks RPC endpoint reachability using a HEAD request (non-mutating).
 *
 * @param rpcUrl - The RPC endpoint URL to check.
 * @param timeoutMs - Request timeout in milliseconds (default: 5000).
 * @returns Endpoint check result.
 *
 * @public
 */
export async function checkRpcEndpointReachability(
  rpcUrl: string | RpcUrl,
  timeoutMs: number = 5000,
): Promise<RpcEndpointCheckResult> {
  const endpoint = String(rpcUrl);
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(endpoint, {
      method: 'HEAD',
      signal: controller.signal,
    }).catch(() => undefined);

    clearTimeout(timeoutId);

    if (!response) {
      return {
        endpoint,
        reachable: false,
        error: 'No response (connection timeout or refused)',
        responseTimeMs: Date.now() - startTime,
      };
    }

    return {
      endpoint,
      reachable: true,
      statusCode: response.status,
      responseTimeMs: Date.now() - startTime,
    };
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : 'Unknown network error';
    return {
      endpoint,
      reachable: false,
      error: errorMsg,
      responseTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Checks availability of a single RPC method by making a test call.
 *
 * For non-destructive testing, uses the latest ledger query (safe to repeat).
 *
 * @param rpcUrl - The RPC endpoint URL.
 * @param method - The RPC method name (e.g., 'simulateTransaction').
 * @param timeoutMs - Request timeout in milliseconds (default: 5000).
 * @returns Method check result.
 *
 * @public
 */
export async function checkRpcMethod(
  rpcUrl: string | RpcUrl,
  method: string,
  timeoutMs: number = 5000,
): Promise<RpcMethodCheckResult> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const body =
      method === 'getLedgerEntries' || method === 'getLatestLedger'
        ? JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getLatestLedger',
            params: [],
          })
        : JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params: [],
          });

    const response = await fetch(String(rpcUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    }).catch((err) => {
      throw new Error(`Fetch failed: ${err.message}`);
    });

    clearTimeout(timeoutId);

    const responseText = await response.text();

    if (!response.ok && response.status !== 400) {
      return {
        method,
        available: false,
        error: `HTTP ${response.status}`,
        responseTimeMs: Date.now() - startTime,
      };
    }

    try {
      const json = JSON.parse(responseText);

      const hasError = json.error || responseText.includes('methodNotFound');
      if (hasError) {
        return {
          method,
          available: false,
          error: json.error?.message || 'Method not found or unsupported',
          responseTimeMs: Date.now() - startTime,
        };
      }

      return {
        method,
        available: true,
        responseTimeMs: Date.now() - startTime,
      };
    } catch (parseErr) {
      return {
        method,
        available: false,
        error: 'Invalid JSON response',
        responseTimeMs: Date.now() - startTime,
      };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    return {
      method,
      available: false,
      error: errorMsg,
      responseTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Performs a comprehensive RPC health check.
 *
 * Checks endpoint reachability and availability of required Soroban RPC methods.
 * This is a non-mutating diagnostic operation safe to run at any time.
 *
 * @param rpcUrl - The RPC endpoint URL to check.
 * @param optionalMethods - Optional additional methods to check beyond required ones.
 * @param timeoutMs - Request timeout in milliseconds (default: 5000).
 * @returns Comprehensive health check result.
 *
 * @example
 * ```ts
 * const result = await checkRpcHealth('https://soroban-testnet.stellar.org');
 * console.log(result.healthy ? 'RPC is healthy' : 'Issues detected');
 * console.log(result.recommendations);
 * ```
 *
 * @public
 */
export async function checkRpcHealth(
  rpcUrl: string | RpcUrl,
  optionalMethods: string[] = [],
  timeoutMs: number = 5000,
): Promise<RpcHealthCheckResult> {
  const timestamp = new Date().toISOString();

  const requiredMethods = [
    'getLatestLedger',
    'getTransaction',
    'getTransactions',
    'simulateTransaction',
    'sendTransaction',
    'getLedgerEntries',
  ];

  const endpointCheck = await checkRpcEndpointReachability(rpcUrl, timeoutMs);

  let requiredResults: RpcMethodCheckResult[] = [];
  let optionalResults: RpcMethodCheckResult[] = [];
  let healthy = endpointCheck.reachable;

  if (endpointCheck.reachable) {
    requiredResults = await Promise.all(
      requiredMethods.map((m) => checkRpcMethod(rpcUrl, m, timeoutMs)),
    );

    if (optionalMethods.length > 0) {
      optionalResults = await Promise.all(
        optionalMethods.map((m) => checkRpcMethod(rpcUrl, m, timeoutMs)),
      );
    }

    const allRequiredAvailable = requiredResults.every((r) => r.available);
    healthy = allRequiredAvailable;
  } else {
    healthy = false;
  }

  const recommendations: string[] = [];

  if (!endpointCheck.reachable) {
    recommendations.push(
      `Endpoint is unreachable: ${endpointCheck.error}. Check network connectivity and RPC URL.`,
    );
  } else if (endpointCheck.statusCode && endpointCheck.statusCode >= 500) {
    recommendations.push(
      `RPC endpoint returning server error (HTTP ${endpointCheck.statusCode}). Try again in a moment.`,
    );
  }

  const unavailableMethods = requiredResults.filter((r) => !r.available);
  if (unavailableMethods.length > 0) {
    const methodNames = unavailableMethods.map((r) => r.method).join(', ');
    recommendations.push(
      `Required methods unavailable: ${methodNames}. Update SDK or contact RPC provider.`,
    );
  }

  const slowMethods = requiredResults.filter(
    (r) => r.responseTimeMs && r.responseTimeMs > 5000,
  );
  if (slowMethods.length > 0) {
    recommendations.push(
      `Some RPC methods are slow (>5s). Network latency or RPC congestion may affect performance.`,
    );
  }

  const summary = healthy
    ? 'RPC endpoint is healthy and all required methods are available.'
    : 'RPC endpoint has issues detected. See recommendations and required method results.';

  return {
    timestamp,
    healthy,
    endpoint: endpointCheck,
    requiredMethods: requiredResults,
    ...(optionalResults.length > 0 ? { optionalMethods: optionalResults } : {}),
    ...(recommendations.length > 0 ? { recommendations } : {}),
    summary,
  };
}
