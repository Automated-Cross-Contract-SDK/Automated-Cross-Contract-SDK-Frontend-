# SDK Diagnostics & Observability

## Overview

This guide covers structured diagnostic events, correlation tracking, and diagnostic snapshots for SDK troubleshooting and support.

---

## Structured Diagnostic Events

The SDK emits structured events for workflow stages that can be observed without parsing messages.

### Event Structure

```typescript
interface DiagnosticEvent {
  // Stable, immutable event name
  name: 'restore.started' | 'restore.completed' | 'restore.failed' | 'restore.step' | 'network.error' | 'auth.required';
  
  // Workflow-level correlation ID (see Correlation IDs)
  workflowId: string;
  
  // Event-level timestamp
  timestamp: number; // milliseconds since epoch
  
  // Safe metadata (no secrets, addresses, XDR)
  metadata: {
    stage?: 'initialization' | 'recovery' | 'validation' | 'finalization';
    errorCode?: string; // e.g., 'AUTH_FAILED', 'NETWORK_TIMEOUT'
    durationMs?: number; // for completion events
    stepName?: string; // for restore.step events
  };
}
```

### Listening to Events

```typescript
import { SDK } from '@sdk/core';

const sdk = new SDK();

// Subscribe to all diagnostic events
sdk.on('diagnostic', (event: DiagnosticEvent) => {
  console.log(`${event.name} [${event.workflowId}]:`, event.metadata);
  
  // Safe to use in logging, metrics, error tracking
  // No sensitive data included
});

// Or filter by event type
sdk.on('restore.failed', (event: DiagnosticEvent) => {
  logger.error(`Restore failed: ${event.metadata.errorCode}`, {
    workflowId: event.workflowId,
    errorCode: event.metadata.errorCode,
  });
});
```

### Event Types & Meanings

| Event | When Fired | Metadata |
|---|---|---|
| `restore.started` | Restore workflow begins | `stage: 'initialization'` |
| `restore.step` | Each major step completes | `stepName`, `durationMs`, `stage` |
| `restore.completed` | Workflow succeeds | `stage: 'finalization'`, `durationMs` |
| `restore.failed` | Workflow fails | `errorCode`, `stage` |
| `network.error` | Network request fails | `errorCode` (e.g., `'TIMEOUT'`, `'UNAVAILABLE'`) |
| `auth.required` | User action needed | (depends on auth type) |

---

## Correlation Identifiers

Each restore workflow is assigned a unique opaque identifier to correlate SDK events with application logs.

### What It Is

- **Opaque**: Random string, no information encoded
- **Per-workflow**: One ID per restore operation
- **Safe**: No wallet addresses, keys, or sensitive data
- **Stable**: Same ID for all events in a workflow

Example: `workflow_a1b2c3d4e5f6g7h8`

### Accessing Workflow ID

```typescript
import { SDK } from '@sdk/core';

const sdk = new SDK();

// Get workflow ID when restore starts
sdk.on('restore.started', (event) => {
  const workflowId = event.workflowId;
  
  // Log alongside application context
  app.log('Restore started', { workflowId, userId: user.id });
});

// Or access from restore function return value
const result = await sdk.restore({
  /* options */
});
console.log('Workflow ID:', result.workflowId);
```

### Using in Logs

```typescript
// Application logs
app.log('user_action', {
  action: 'restore_requested',
  userId: user.id,
  workflowId: event.workflowId, // ← Include this
  timestamp: new Date().toISOString(),
});

// Correlate with SDK logs
sdk.on('restore.completed', (event) => {
  app.log('restore_success', {
    workflowId: event.workflowId, // ← Same ID
    durationMs: event.metadata.durationMs,
  });
});
```

### In Support Requests

When reporting issues, provide the workflow ID:

```
I encountered an error during restore.
Workflow ID: workflow_a1b2c3d4e5f6g7h8
Error code: AUTH_FAILED
Timestamp: 2024-10-22T14:30:00Z
```

The support team can use this to correlate with SDK logs and trace the workflow.

---

## Diagnostic Snapshots

Generate a redacted report for support requests without exposing secrets.

### Creating a Snapshot

```typescript
import { SDK } from '@sdk/core';

const sdk = new SDK();

// Create snapshot (safe to share with support)
const snapshot = sdk.getDiagnosticSnapshot();

console.log(snapshot);
```

### Snapshot Contents

```json
{
  "sdkVersion": "2.1.3",
  "environment": {
    "runtime": "node",
    "nodeVersion": "18.12.0",
    "platform": "linux"
  },
  "network": {
    "networkId": "TESTNET",
    "rpcEndpoint": "https://soroban-testnet.stellar.org"
  },
  "lastWorkflow": {
    "workflowId": "workflow_a1b2c3d4e5f6g7h8",
    "stage": "validation",
    "lastError": {
      "code": "SIGNATURE_INVALID",
      "timestamp": "2024-10-22T14:30:00.000Z"
    }
  }
}
```

### What's Redacted

The snapshot **intentionally excludes**:
- Wallet addresses ❌
- Transaction XDR ❌
- Private keys or secrets ❌
- Full error messages (only codes) ❌
- User PII ❌

### Sharing with Support

```typescript
const snapshot = sdk.getDiagnosticSnapshot();
const report = JSON.stringify(snapshot, null, 2);

// Safe to email or paste in support ticket
// No secrets included
```

Example support message:

```
Subject: Restore failing with SIGNATURE_INVALID

I'm getting an error during the signing step. Here's my diagnostic snapshot:

<snapshot JSON>

Workflow ID: workflow_a1b2c3d4e5f6g7h8
```

---

## Integration Examples

### React App

```typescript
import { SDK } from '@sdk/core';
import { useEffect, useState } from 'react';

function RestoreUI() {
  const [status, setStatus] = useState('idle');
  const [workflowId, setWorkflowId] = useState<string | null>(null);

  useEffect(() => {
    const sdk = new SDK();

    sdk.on('restore.started', (event) => {
      setStatus('restoring');
      setWorkflowId(event.workflowId);
      
      // Log for debugging
      console.log('Restore started:', event.workflowId);
    });

    sdk.on('restore.completed', (event) => {
      setStatus('success');
    });

    sdk.on('restore.failed', (event) => {
      setStatus('error');
      console.error(`Failed: ${event.metadata.errorCode}`);
    });

    return () => sdk.off('diagnostic');
  }, []);

  return (
    <div>
      <p>Status: {status}</p>
      {workflowId && <code>{workflowId}</code>}
    </div>
  );
}
```

### Logging/Monitoring

```typescript
import { SDK } from '@sdk/core';
import { logger } from './logging';

const sdk = new SDK();

// Send events to monitoring service
sdk.on('diagnostic', (event) => {
  logger.event({
    name: event.name,
    workflowId: event.workflowId,
    metadata: event.metadata,
    timestamp: event.timestamp,
  });
});

// Metrics: track restore duration
sdk.on('restore.completed', (event) => {
  logger.metric('restore_duration_ms', event.metadata.durationMs || 0);
});

// Alerting: notify on failures
sdk.on('restore.failed', (event) => {
  logger.alert('SDK restore failed', {
    workflowId: event.workflowId,
    errorCode: event.metadata.errorCode,
  });
});
```

---

## Security & Privacy

### Safe Practices

✅ Log diagnostic events
✅ Include workflow ID in support tickets
✅ Share diagnostic snapshots with support
✅ Use error codes in metrics/alerts
✅ Trace workflows with correlation IDs

### Never Do This

❌ Log raw error messages (may contain addresses)
❌ Include XDR in logs
❌ Share full transaction objects
❌ Log private keys or secrets
❌ Use wallet addresses in metrics

---

## Troubleshooting

### "No diagnostic events received"

1. Ensure you're listening to the right event:
   ```typescript
   sdk.on('diagnostic', (event) => console.log(event));
   ```

2. Check SDK version (2.1.0+):
   ```typescript
   console.log(sdk.version);
   ```

3. Verify diagnostics are enabled (default: enabled):
   ```typescript
   const sdk = new SDK({ diagnostics: true });
   ```

### "Snapshot is empty"

- Snapshot contains lastWorkflow only if a restore was attempted
- After first restore attempt, snapshot will be populated

### "Workflow ID not matching my logs"

- Workflow ID is per-restore operation, not per-application session
- Each `restore()` call gets a new workflow ID
- Match by timestamp if needed

---

## API Reference

### SDK Methods

```typescript
// Listen to events
sdk.on(eventType: string, callback: (event: DiagnosticEvent) => void): void
sdk.off(eventType: string, callback?: Function): void

// Get current diagnostics
sdk.getDiagnosticSnapshot(): DiagnosticSnapshot

// Configure diagnostics
new SDK({ diagnostics: true | false })
```

### Types

```typescript
interface DiagnosticEvent {
  name: string;
  workflowId: string;
  timestamp: number;
  metadata: Record<string, any>;
}

interface DiagnosticSnapshot {
  sdkVersion: string;
  environment: { runtime: string; ... };
  network: { networkId: string; ... };
  lastWorkflow?: {
    workflowId: string;
    stage: string;
    lastError?: { code: string; timestamp: string };
  };
}
```

---

## Support & Feedback

- Found a bug? Include the workflow ID in your report
- Have feedback? Open an issue on GitHub
- Need help? Email: support@example.com
