# React Hook API Reference (`@soroban-resurrect/react-hook`)

The React package offers two ways to use the SDK: a **context provider + hook** pair (shares one instance across a subtree), and a **standalone hook** (owns its own instance, no provider required).

## Context API

### `SorobanResurrectProvider`

```tsx
<SorobanResurrectProvider config={config}>
  {children}
</SorobanResurrectProvider>
```

React context provider that instantiates `SorobanResurrect` and subscribes to its state changes. When the `config` prop changes (by deep equality), a new SDK instance is created and state resets to `idle`.

**Props** (`SorobanResurrectProviderProps`)

| Prop       | Type                     | Description               |
| ---------- | ------------------------ | -------------------------- |
| `config`   | `SorobanResurrectConfig` | SDK configuration.          |
| `children` | `ReactNode`              | React children.             |

### `useSorobanResurrectContext()`

```typescript
function useSorobanResurrectContext(): {
  resurrect: SorobanResurrect | null
  config: SorobanResurrectConfig
  state: RestoreStateInfo
  isProcessing: boolean
  submitWithRestore(tx: Transaction, wallet: WalletAdapter): Promise<ResurrectResult>
  detectArchivedKeys(tx: Transaction): Promise<ArchivedLedgerEntry[]>
  reset(): void
  on<K extends keyof SorobanResurrectEvents>(
    event: K,
    listener: (payload: SorobanResurrectEvents[K]) => void,
  ): () => void
}
```

Hook to access the `SorobanResurrect` API from within a `<SorobanResurrectProvider>`. Throws if used outside the provider.

- `isProcessing` is `true` while `state.state` is any of: `simulating`, `signing_restore`, `submitting_restore`, `confirming_restore`, `signing_original`, `submitting_original`.
- `submitWithRestore` and `detectArchivedKeys` are safe to call before the underlying instance mounts — they return an idle-shaped fallback (`{ success: false, error: 'Not initialized' }` / `[]`) rather than throwing.
- `on` subscribes to a typed lifecycle event on the current SDK instance and returns an unsubscribe function. See [Lifecycle Events](#lifecycle-events) below.

#### `isProcessing` contract

`isProcessing` is computed as `isProcessingState(state.state)`, using the
`isProcessingState` / `PROCESSING_STATES` helpers exported by
`@soroban-resurrect/sdk` — the same helpers the Vue and Svelte hooks use, so
all three frameworks agree on what counts as "in flight". Notably,
`restore_needed` is **not** treated as processing: it's a momentary
notification state set the instant archived entries are detected, before
any restore call or wallet prompt is actually in flight. See
[Processing State Helpers](../API.md#processing-state-helpers) in the API
reference for the full state set and rationale.

## Standalone Hook

### `useSorobanResurrect(options)`

```typescript
function useSorobanResurrect(options: UseSorobanResurrectOptions): UseSorobanResurrectReturn
```

Creates and manages its own `SorobanResurrect` instance — no provider needed. Suitable for components used outside a `SorobanResurrectProvider`, or for isolated instances per-component. Subscribes to state changes and exposes the full API. When `options.config` changes, a new SDK instance is created and state resets to `idle`.

**Options** (`UseSorobanResurrectOptions`)

| Field    | Type                     | Description        |
| -------- | ------------------------ | -------------------- |
| `config` | `SorobanResurrectConfig` | SDK configuration.    |

**Returns** (`UseSorobanResurrectReturn`)

| Field                 | Type                                                              | Description                                  |
| ---------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| `state`                | `RestoreStateInfo`                                                  | Current workflow state snapshot.                |
| `isProcessing`         | `boolean`                                                           | Whether a restore/submit operation is running.  |
| `submitWithRestore`    | `(transaction: Transaction, wallet: WalletAdapter) => Promise<ResurrectResult>` | Submit with automatic restoration. |
| `detectArchivedKeys`   | `(transaction: Transaction) => Promise<ArchivedLedgerEntry[]>`     | Check for archived entries.                     |
| `reset`                | `() => void`                                                        | Reset state back to idle.                       |
| `on`                    | `<K>(event: K, listener: (payload) => void) => () => void`         | Subscribe to a lifecycle event. See below.      |
| `resurrect`            | `SorobanResurrect`                                                  | The underlying SDK instance.                    |

## Lifecycle Events

Both `useSorobanResurrectContext()` and `useSorobanResurrect()` expose an `on` helper backed by the underlying SDK instance's `on`/`off` event emitter (`resurrect.on(...)`), so dApp teams can wire up telemetry or progress UIs without reaching into `resurrect` directly. `on` always subscribes to the *current* SDK instance — resubscribe if you call it again after `config` changes.

| Event               | Payload               | Fires when                                                        |
| -------------------- | ---------------------- | -------------------------------------------------------------------- |
| `stateChange`        | `RestoreStateInfo`      | On every state transition (mirrors `onStateChange`).                 |
| `restoreNeeded`       | `ArchivedLedgerEntry[]` | Archived entries are detected and restoration is required.           |
| `restoreSubmitted`    | `TxHash`                | The restore transaction is submitted.                                |
| `restoreConfirmed`    | `TxHash`                | The restore transaction is confirmed on-chain.                       |
| `originalSubmitted`   | `TxHash`                | The original transaction is submitted.                               |
| `restoreComplete`     | `ResurrectResult`       | The full restore-and-submit workflow finishes.                       |
| `error`               | `string`                | The workflow fails, with the error message.                          |

```tsx
useEffect(() => {
  const unsubscribe = on('restoreSubmitted', (txHash) => {
    console.log('restore submitted:', txHash)
  })
  return unsubscribe
}, [on])
```

## Choosing Between Them

- Use **`SorobanResurrectProvider`** when multiple components in a subtree need the same SDK instance and shared state (e.g. a global "transaction status" toast tied to one config).
- Use **`useSorobanResurrect`** when a component needs its own isolated instance — for example, multiple independent transaction widgets on the same page each targeting a different config.

See [Framework Integrations](/integrations/react) for full setup examples.
