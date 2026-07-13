# Soroban-Resurrect

**Automated Cross-Contract State Restoration SDK & Wallet Middleware**

Soroban-Resurrect solves the "archived ledger entry" problem for Soroban dApps. When a user's persistent data (token balance, loan position, etc.) expires due to TTL rent, their transaction fails with a cryptic error. This SDK automatically detects archived entries via CAP-0066 and seamlessly restores them before submitting the user's intended transaction.

```
[User Action: Withdraw]
        │
        ▼
[dApp Frontend] ──► Soroban-Resurrect
                          │
                    ┌─────┴──────┐
                    ▼            ▼
              Simulate      Detect
              Transaction   Archived
              (RPC)         Keys
                    │            │
                    └──────┬─────┘
                           ▼
                    RestoreFootprintOp
                           │
                    ┌──────┴──────┐
                    ▼             ▼
              Restore Tx     Original Tx
              (sign+send)   (sign+send)
```

---

## Packages

| Package                         | Description                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `@soroban-resurrect/sdk`        | Core TypeScript SDK — wraps Soroban RPC, detects archived keys, builds & executes restore transactions |
| `@soroban-resurrect/react-hook` | React context provider + hook for easy dApp integration                                                |

## Quick Start

```bash
npm install @soroban-resurrect/sdk @stellar/stellar-sdk
```

### 1. Direct SDK Usage

```typescript
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { TransactionBuilder, Account, Operation, Networks } from '@stellar/stellar-sdk'

const sr = new SorobanResurrect({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
})

// Check if a transaction needs restoration
const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
  .addOperation(
    Operation.invokeContractFunction({
      contract: 'CCJZ5...K2Q',
      function: 'withdraw',
      args: [nativeToScVal(1000, { type: 'i128' })],
    }),
  )
  .setTimeout(30)
  .build()

const needsRestore = await sr.needsRestore(tx)
// → true if archived ledger entries are detected

// Submit with automatic restore
const wallet = {
  isConnected: async () => true,
  getPublicKey: async () => freighter.publicKey,
  signTransaction: async (txXdr, opts) => freighter.signTransaction(txXdr, opts),
}

const result = await sr.submitWithRestore({ transaction: tx, wallet })

if (result.success) {
  console.log('Original tx hash:', result.originalTxHash)
  if (result.restoreTxHash) {
    console.log('Restore tx hash:', result.restoreTxHash)
    console.log('Archived keys restored:', result.archivedKeysDetected)
  }
} else {
  console.error('Failed:', result.error)
}
```

### 2. React Hook (Context API)

```tsx
import { SorobanResurrectProvider, useSorobanResurrectContext } from '@soroban-resurrect/react-hook'

function App() {
  return (
    <SorobanResurrectProvider config={{ rpcUrl: 'https://soroban-testnet.stellar.org' }}>
      <WithdrawButton />
    </SorobanResurrectProvider>
  )
}

function WithdrawButton() {
  const { submitWithRestore, state, isProcessing } = useSorobanResurrectContext()

  const handleWithdraw = async () => {
    const result = await submitWithRestore(tx, wallet)
    // result.success, result.originalTxHash, etc.
  }

  return (
    <button onClick={handleWithdraw} disabled={isProcessing}>
      {isProcessing ? state.message : 'Withdraw'}
    </button>
  )
}
```

### 3. Standalone Hook (no Provider)

```tsx
import { useSorobanResurrect } from '@soroban-resurrect/react-hook'

function WithdrawButton() {
  const { submitWithRestore, state, isProcessing } = useSorobanResurrect({
    config: { rpcUrl: 'https://soroban-testnet.stellar.org' },
  })
  // same API as context version
}
```

---

## Architecture

### CAP-0066 Restoration Flow

The SDK implements the complete [CAP-0066](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0066.md) restoration flow:

1. **Simulate** — Calls `simulateTransaction` on the Soroban RPC endpoint
2. **Detect** — Checks if the response is a `SimulateTransactionRestoreResponse` (via `Api.isSimulationRestore()`); extracts the archived ledger keys from the `SorobanDataBuilder` footprint
3. **Build Restore Tx** — Constructs a transaction with `Operation.restoreFootprint({})` using the restore preamble data (footprint + resource fee from simulation)
4. **Wallet Sign #1** — Prompts the user's wallet to sign the restore transaction
5. **Submit Restore** — Sends the restore transaction and polls `getTransaction` until confirmed
6. **Rebuild Original** — After restore confirms, re-simulates the original transaction, rebuilds it with a fresh account sequence number and the new simulation data via `assembleTransaction`
7. **Wallet Sign #2** — Prompts the wallet to sign the prepared original transaction
8. **Submit Original** — Sends the user's intended transaction

### Failure Handling

- **Simulation errors** are returned immediately with the error message
- **Restore transaction failure** returns the restore tx hash and error details
- **Re-simulation failure** after successful restore returns an error (unusual — indicates the restore wasn't sufficient)
- All exceptions are caught and returned as structured `ResurrectResult` objects

---

## API Reference

### `SorobanResurrect` (SDK)

```typescript
constructor(config: SorobanResurrectConfig)

// Properties
server: rpc.Server              // The underlying Soroban RPC server
config: Required<SorobanResurrectConfig>
state: RestoreState              // Current state machine state
stateInfo: RestoreStateInfo      // State + message + archived keys + error

// Methods
simulate(transaction: Transaction): Promise<SimulateResponse>
detectArchivedKeys(transaction: Transaction): Promise<ArchivedLedgerEntry[]>
needsRestore(transaction: Transaction): Promise<boolean>
buildRestoreTx(sourcePublicKey: string, transaction: Transaction): Promise<Transaction>
submitWithRestore(options: SubmitWithRestoreOptions): Promise<ResurrectResult>
onStateChange(listener: (info: RestoreStateInfo) => void): () => void  // unsubscribe
```

### React Hook

```typescript
// Context Provider
<SorobanResurrectProvider config={config}>
  {children}
</SorobanResurrectProvider>

// Context Hook
useSorobanResurrectContext(): {
  resurrect: SorobanResurrect | null
  config: SorobanResurrectConfig
  state: RestoreStateInfo
  isProcessing: boolean
  submitWithRestore(tx, wallet): Promise<ResurrectResult>
  detectArchivedKeys(tx): Promise<ArchivedLedgerEntry[]>
  reset(): void
}

// Standalone Hook
useSorobanResurrect({ config }): UseSorobanResurrectReturn  // same shape
```

### Types

```typescript
interface SorobanResurrectConfig {
  rpcUrl: string
  networkPassphrase?: string // default: Testnet
  pollIntervalMs?: number // default: 1000
  pollTimeoutMs?: number // default: 60000
}

interface WalletAdapter {
  isConnected(): Promise<boolean>
  getPublicKey(): Promise<string>
  signTransaction(tx: string, opts?: { networkPassphrase?: string }): Promise<string>
}

interface ResurrectResult {
  success: boolean
  originalTxHash?: string
  restoreTxHash?: string
  archivedKeysDetected: number
  error?: string
}

type RestoreState =
  | 'idle'
  | 'simulating'
  | 'restore_needed'
  | 'signing_restore'
  | 'submitting_restore'
  | 'confirming_restore'
  | 'signing_original'
  | 'submitting_original'
  | 'success'
  | 'error'
```

---

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test

# Type-check
npm run typecheck

# Run example app
npm run dev:example
```

### Project Structure

```
├── packages/
│   ├── sdk/                          # @soroban-resurrect/sdk
│   │   ├── src/
│   │   │   ├── SorobanResurrect.ts    # Main class
│   │   │   ├── Archiver.ts           # Archived key detection
│   │   │   ├── Restorer.ts           # Restore tx builder
│   │   │   ├── Executor.ts           # Full execution flow
│   │   │   ├── types.ts              # Type definitions
│   │   │   ├── constants.ts          # Defaults
│   │   │   ├── index.ts              # Exports
│   │   │   └── __tests__/            # Unit tests (vitest)
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── react-hook/                   # @soroban-resurrect/react-hook
│       ├── src/
│       │   ├── SorobanResurrectContext.tsx
│       │   ├── useSorobanResurrect.ts
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── examples/basic/                   # Vite + React demo app
├── .github/workflows/ci.yml
├── package.json                      # Root workspace config
└── tsconfig.json
```

---

## License

MIT
