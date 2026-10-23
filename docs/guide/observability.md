# SDK Observability: Metrics, Health Checks, and Privacy-Safe Logging

This guide covers three observability features for production deployments:
1. **Metrics hooks** — Framework-neutral callbacks for monitoring
2. **RPC health checks** — Diagnostic endpoints for support tooling
3. **Privacy-safe logging** — Redaction utilities for sensitive data

---

## Metrics Hooks

The SDK emits framework-neutral callbacks for success, failure, and recovery outcomes. Use these to integrate with your metrics system (Datadog, New Relic, Prometheus, etc.) without coupling to any specific vendor.

### Basic Usage

```typescript
import { SorobanResurrect, MetricsHook } from '@sdk/core';

const metricsHook: MetricsHook = {
  onOutcome: (metadata) => {
    console.log(`Workflow completed: ${metadata.outcomeCode}`);
    // Send to your metrics service
    myMetricsClient.emit('soroban_workflow', {
      stage: metadata.stage,
      duration_ms: metadata.durationMs,
      outcome: metadata.outcomeCode,
    });
  },

  onRecovery: (metadata) => {
    console.log(`Retrying: attempt ${metadata.attemptNumber}`);
    // Track retries
    myMetricsClient.increment('soroban_retry', {
      stage: metadata.stage,
      attempt: metadata.attemptNumber,
    });
  },

  onProgress: (stage, progressMetadata) => {
    console.log(`Progress: ${stage}`);
    // Optional: periodic progress updates
  },
};

const sdk = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
  metricsHook,
});

const result = await sdk.restore({ ... });
// onOutcome will be called when complete
```

### Metadata Fields

All metrics callbacks receive **safe metadata only** — no wallet addresses, keys, transaction XDR, or other sensitive data.

#### OutcomeMetadata

```typescript
interface MetricsOutcomeMetadata {
  // Unique correlation ID for this workflow
  workflowId?: string;

  // Final stage reached (e.g., 'finalization', 'original_submission')
  stage?: MetricsStage;

  // Machine-readable outcome code:
  // 'SUCCESS', 'NO_RESTORE_NEEDED', 'RESTORE_FAILED', 'ORIGINAL_FAILED', etc.
  outcomeCode?: MetricsOutcomeCode;

  // Total workflow duration in milliseconds
  durationMs?: number;

  // Number of transient retries
  retries?: number;

  // Number of archived ledger entries (if applicable)
  archivedKeysCount?: number;

  // Estimated restore fee in stroops (safe integer, not address-specific)
  estimatedRestoreFeeStoops?: number;

  // Custom low-cardinality labels (not addresses or hashes)
  customLabels?: Record<string, string | number | boolean>;
}
```

### Stages

Metrics track these stages in the restore workflow:

| Stage | Meaning |
|---|---|
| `initialization` | SDK startup and config validation |
| `simulation` | Transaction simulation for archived keys |
| `restore_preparation` | Building restore transaction |
| `restore_submission` | Signing and submitting restore tx |
| `restore_confirmation` | Waiting for restore tx to finalize |
| `original_submission` | Signing and submitting original tx |
| `original_confirmation` | Waiting for original tx to finalize |
| `finalization` | Cleanup and result assembly |

### Outcome Codes

| Code | Meaning |
|---|---|
| `SUCCESS` | Both restore and original tx succeeded |
| `NO_RESTORE_NEEDED` | Simulation showed no archived keys |
| `SIMULATION_FAILED` | Pre-flight check rejected the transaction |
| `RESTORE_SUBMITTED` | Restore tx sent (user aborted before original) |
| `RESTORE_CONFIRMED` | Restore finalized but original never submitted |
| `RESTORE_TIMEOUT` | Restore confirmation took too long |
| `RESTORE_FAILED` | Restore tx failed on-chain |
| `ORIGINAL_FAILED` | Restore succeeded, but original tx failed |
| `NETWORK_ERROR` | RPC connection or network timeout |
| `INVALID_CONFIG` | Bad config (wrong network, bad RPC URL, etc.) |
| `ABORTED_BY_USER` | User called `.abort()` on the workflow |
| `UNKNOWN_ERROR` | Unexpected error |

### Cardinality Constraints

To prevent unbounded cardinality growth:

- **Stage names** are from a fixed set (see table above)
- **Outcome codes** are from a fixed set (see table above)
- **Custom labels** must use low-cardinality values:
  - ✅ `{ environment: 'testnet', retry_strategy: 'exponential' }`
  - ❌ `{ tx_hash: '...' }` (unbounded cardinality)
  - ❌ `{ wallet_address: '...' }` (PII)

### Privacy Constraints

Hooks receive only safe metadata:

- ✅ Workflow ID (opaque, no information)
- ✅ Stage names and outcome codes
- ✅ Durations, retry counts, cardinality
- ❌ Wallet addresses
- ❌ Transaction hashes or XDR
- ❌ Error messages (only error codes)
- ❌ Contract IDs or account sequences

### Integration Examples

#### With Datadog

```typescript
import { StatsdClient } from 'node-dogstatsd';

const statsd = new StatsdClient();

const metricsHook: MetricsHook = {
  onOutcome: (metadata) => {
    statsd.histogram('soroban.workflow.duration_ms', metadata.durationMs || 0, {
      stage: metadata.stage,
      outcome: metadata.outcomeCode,
    });
  },
};
```

#### With Prometheus

```typescript
import prom from 'prom-client';

const workflowCounter = new prom.Counter({
  name: 'soroban_workflows_total',
  help: 'Total workflows completed',
  labelNames: ['stage', 'outcome'],
});

const durationHistogram = new prom.Histogram({
  name: 'soroban_workflow_duration_seconds',
  help: 'Workflow duration',
  labelNames: ['outcome'],
});

const metricsHook: MetricsHook = {
  onOutcome: (metadata) => {
    workflowCounter
      .labels(metadata.stage || '', metadata.outcomeCode || '')
      .inc();

    durationHistogram
      .labels(metadata.outcomeCode || '')
      .observe((metadata.durationMs || 0) / 1000);
  },
};
```

---

## RPC Health Checks

The SDK provides non-mutating diagnostics to test RPC endpoint reachability and required method availability.

### Basic Usage

```typescript
import { checkRpcHealth } from '@sdk/core';

// Comprehensive check
const result = await checkRpcHealth('https://soroban-testnet.stellar.org');

console.log(result.healthy ? '✓ Healthy' : '✗ Issues detected');
console.log(result.summary);
console.log(result.recommendations);

// Check specific endpoint only
const endpointResult = await checkRpcEndpointReachability(rpcUrl);
console.log(`Latency: ${endpointResult.responseTimeMs}ms`);

// Check specific method
const methodResult = await checkRpcMethod(rpcUrl, 'simulateTransaction');
console.log(`Method available: ${methodResult.available}`);
```

### Health Check Result

```typescript
interface RpcHealthCheckResult {
  // ISO 8601 timestamp
  timestamp: string;

  // Overall health status
  healthy: boolean;

  // Endpoint reachability (HTTP HEAD request)
  endpoint: RpcEndpointCheckResult;

  // Required Soroban methods: getLatestLedger, getTransaction, simulateTransaction, etc.
  requiredMethods: RpcMethodCheckResult[];

  // Optional additional methods checked (if provided)
  optionalMethods?: RpcMethodCheckResult[];

  // Actionable recommendations (if issues detected)
  recommendations?: string[];

  // Summary message
  summary: string;
}
```

### Example Output

```json
{
  "timestamp": "2024-10-22T14:30:00.000Z",
  "healthy": true,
  "endpoint": {
    "endpoint": "https://soroban-testnet.stellar.org",
    "reachable": true,
    "statusCode": 200,
    "responseTimeMs": 145
  },
  "requiredMethods": [
    {
      "method": "getLatestLedger",
      "available": true,
      "responseTimeMs": 120
    },
    {
      "method": "simulateTransaction",
      "available": true,
      "responseTimeMs": 350
    }
  ],
  "summary": "RPC endpoint is healthy and all required methods are available."
}
```

### Use Cases

#### Support Diagnostics

Include health check results when reporting issues:

```typescript
const health = await checkRpcHealth(config.rpcUrl);
console.log('Please share this with support:', JSON.stringify(health, null, 2));
```

#### Startup Validation

Fail fast if RPC is unhealthy:

```typescript
const health = await checkRpcHealth(rpcUrl, [], 5000);
if (!health.healthy) {
  throw new Error(`RPC unavailable: ${health.summary}`);
}
```

#### Monitoring Dashboard

Periodically check RPC health and alert on failures:

```typescript
setInterval(async () => {
  const health = await checkRpcHealth(rpcUrl);
  if (!health.healthy) {
    alerting.notify(`RPC health degraded: ${health.recommendations?.[0]}`);
  }
}, 60000); // Check every minute
```

---

## Privacy-Safe Logging

The SDK provides redaction utilities and field classification to help you log safely without exposing sensitive data.

### What You Can Log

✅ **Always safe:**
- Workflow IDs (opaque, no information)
- Stage names (`simulation`, `restore_submission`, etc.)
- Error codes (`SIMULATE_FAILED`, `RESTORE_TIMEOUT`, etc.)
- Durations, retry counts, and metrics
- SDK version and environment info

### What You Must Redact

⚠️ **Sensitive (redact as hash only):**
- Wallet address: log as `GA...abc3` (first 2 + last 4 chars)
- Public key: log as `PK...xyz7`
- Contract ID: log as `...abcd` (last 4 chars)
- Transaction hash: log as `...e1f2` (last 4 chars, for correlation only)

### What You Must Never Log

❌ **Forbidden (even redacted):**
- Private keys or secrets
- Transaction XDR or full transaction objects
- Authorization preimages or signatures
- Account sequences
- Full error messages (use error codes instead)

### Using Redaction Utilities

```typescript
import { RedactionUtils, SafeLogger } from '@sdk/core';

// Redact individual values
const address = 'GABC...xyz123';
const safe = RedactionUtils.hashAddress(address);
// safe = "GA...z123"

// Filter objects automatically
const result = {
  workflowId: 'wf_abc123',
  address: 'GABC...xyz',
  privateKey: 'S...', // FORBIDDEN
  durationMs: 150,
};

const safeForLogging = RedactionUtils.filterObject(result);
// Returns: { workflowId: 'wf_abc123', durationMs: 150 }

// With sensitive fields redacted
const withRedacted = RedactionUtils.filterObject(result, true);
// Returns: { workflowId: 'wf_abc123', address: 'GA...xyz', durationMs: 150 }
```

### SafeLogger Class

Use `SafeLogger` to automatically filter and redact log objects:

```typescript
const logger = new SafeLogger(false); // false = don't log sensitive fields

logger.info('Workflow started', {
  workflowId: 'wf_123',
  address: 'GABC...xyz',
  stage: 'initialization',
});
// Output: Workflow started: {"workflowId":"wf_123","stage":"initialization"}

const loggerWithRedacted = new SafeLogger(true);
loggerWithRedacted.info('Result', {
  workflowId: 'wf_456',
  address: 'GABC...uvw',
  durationMs: 250,
});
// Output: Result: {"workflowId":"wf_456","address":"GA...uvw","durationMs":250}
```

### Field Classification

The SDK defines privacy classification for common fields:

```typescript
import { LoggingClassifications, LoggingFieldType } from '@sdk/core';

// Check if a field is safe to log
LoggingClassifications.forEach((classification) => {
  console.log(`${classification.field}: ${classification.type}`);
});

// Output:
// privateKey: forbidden
// address: sensitive
// workflowId: public
// durationMs: public
```

### Best Practices

#### ❌ Bad: Full error message exposes details

```typescript
try {
  await sdk.restore({ ... });
} catch (err) {
  logger.error('Restore failed:', err); // May contain addresses!
}
```

#### ✅ Good: Use error code + safe context

```typescript
try {
  await sdk.restore({ ... });
} catch (err) {
  const errorCode = err.code || 'UNKNOWN_ERROR';
  logger.error('Restore failed', {
    errorCode,
    stage: currentStage,
    workflowId,
  });
}
```

#### ❌ Bad: Logs wallet addresses

```typescript
logger.info('Processing', {
  walletAddress: user.publicKey,
  amount: '100',
});
```

#### ✅ Good: Redact addresses

```typescript
logger.info('Processing', {
  walletAddressHash: RedactionUtils.hashAddress(user.publicKey),
  amount: '100',
});
```

---

## Troubleshooting

### "My metrics system isn't receiving events"

Check that:
1. `metricsHook` is passed to `SorobanResurrect` config
2. The hook method (`onOutcome`, `onRecovery`, etc.) matches the event type
3. No exceptions are thrown in the hook callback
4. Your metrics client is initialized before creating the SDK

### "RPC health check says endpoint is unhealthy"

1. Check network connectivity: `ping` the RPC host
2. Verify the URL is correct: `https://soroban-mainnet.stellar.org` vs testnet
3. Check if the RPC service is experiencing issues: check status page
4. Try with a longer timeout: `checkRpcHealth(url, [], 10000)`

### "I'm accidentally logging sensitive data"

1. Use `SafeLogger` to automatically filter objects
2. Check field types with `RedactionUtils.isForbidden(fieldName)`
3. Redact manually with `RedactionUtils.hashAddress()` or `RedactionUtils.hashSuffix()`
4. Review logs for forbidden patterns: `grep -E "(0x[a-f0-9]{40}|privKey|secret|SK[A-Z0-9]{54})"` logs/

---

## API Reference

### MetricsHook

```typescript
interface MetricsHook {
  onOutcome?(metadata: MetricsOutcomeMetadata): void | Promise<void>;
  onRecovery?(metadata: MetricsRecoveryMetadata): void | Promise<void>;
  onProgress?(stage: MetricsStage, progressMetadata?: Record<string, any>): void | Promise<void>;
}
```

### RPC Health Check Functions

```typescript
// Comprehensive check
checkRpcHealth(rpcUrl: string, optionalMethods?: string[], timeoutMs?: number): Promise<RpcHealthCheckResult>

// Endpoint only
checkRpcEndpointReachability(rpcUrl: string, timeoutMs?: number): Promise<RpcEndpointCheckResult>

// Single method
checkRpcMethod(rpcUrl: string, method: string, timeoutMs?: number): Promise<RpcMethodCheckResult>
```

### Logging & Redaction

```typescript
class RedactionUtils {
  static hashAddress(address: string): string;
  static hashSuffix(hexString: string, chars?: number): string;
  static redactXdr(_txXdr: string): string;
  static filterObject(obj: Record<string, unknown>, allowSensitive?: boolean): Record<string, unknown>;
  static isForbidden(fieldName: string): boolean;
  static isSensitive(fieldName: string): boolean;
}

class SafeLogger {
  constructor(allowSensitive?: boolean);
  info(label: string, obj: Record<string, unknown>, logger?: (msg: string) => void): void;
  error(label: string, err: unknown, context?: Record<string, unknown>, logger?: (msg: string) => void): void;
}
```

---

## Related Docs

- [Diagnostics](./diagnostics.md) — Transaction failure diagnostics parsing
- [Testing](./testing.md) — Unit testing with mocks and fixtures
- [API Reference](../api/sdk.md) — Complete SDK API
