# Examples

## Runnable Example App

The repository ships a full runnable example at [`examples/basic`](https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-/tree/main/examples/basic) — a Vite + React app wired up to the SDK end-to-end.

```bash
git clone https://github.com/Automated-Cross-Contract-SDK/Automated-Cross-Contract-SDK-Frontend-.git
cd Automated-Cross-Contract-SDK-Frontend-
npm install
npm run dev:example
```

This starts a local dev server demonstrating connecting a wallet, building a transaction, and calling `submitWithRestore`.

## Interactive Playground

Want to try the flow without installing anything? The
[Interactive Playground](/examples/playground) runs the SDK's state machine in
your browser against a fake RPC client with canned responses — no wallet, no
network. Edit the snippet, pick a scenario, and watch the state transitions,
RPC calls, and result.

## Interactive Snippets

### Minimal restore check

```typescript
import { SorobanResurrect } from '@soroban-resurrect/sdk'

const sr = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })

const needsRestore = await sr.needsRestore(tx)
console.log(needsRestore ? 'Restore required' : 'Ready to submit')
```

### Progress bar driven by `onStateChange`

```typescript
const STEPS: Record<string, number> = {
  idle: 0,
  simulating: 10,
  restore_needed: 20,
  signing_restore: 35,
  submitting_restore: 50,
  confirming_restore: 65,
  signing_original: 80,
  submitting_original: 90,
  success: 100,
  error: 100,
}

sr.onStateChange((info) => {
  progressBar.value = STEPS[info.state] ?? 0
  statusLabel.textContent = info.message
})
```

### Rendering archived keys detected during a restore

```tsx
function ArchivedKeysBanner({ archivedKeys }: { archivedKeys: ArchivedLedgerEntry[] }) {
  if (archivedKeys.length === 0) return null

  return (
    <div className="banner">
      {archivedKeys.length} ledger {archivedKeys.length === 1 ? 'entry needs' : 'entries need'} to
      be restored before this transaction can be submitted.
    </div>
  )
}
```

### Full submit flow with error handling

```typescript
async function withdraw(tx: Transaction, wallet: WalletAdapter) {
  const result = await sr.submitWithRestore({
    transaction: tx,
    wallet,
    onRestoreNeeded: (keys) => setBanner(`Restoring ${keys.length} archived entries…`),
    onRestoreFailed: (error) => setError(error),
  })

  if (!result.success) {
    setError(result.error ?? 'Unknown error')
    return
  }

  setSuccess(result.originalTxHash!)
}
```

## Typed Contract Invocation Scaffolding (opt-in)

The scaffolder can emit a typed contract invocation example for a given
contract. It is **opt-in**: nothing is generated unless you explicitly run the
command, and every generated artifact is plain, inspectable source — no runtime
magic, no hidden codegen step at build time.

### Stable interface

```bash
npx soroban-resurrect scaffold contract \
  --contract-id C...ABC \
  --out ./src/contracts/abc \
  --methods transfer,balance
```

| Flag | Required | Description |
| --- | --- | --- |
| `--contract-id` | yes | The contract ID to generate an invocation example for. |
| `--out` | yes | Directory the generated files are written to. Must be empty or absent. |
| `--methods` | no | Comma-separated method names to include. Defaults to all methods discovered from the contract spec. |
| `--force` | no | Overwrite an existing output directory. Off by default. |

### What gets generated

Two files are written to `--out`:

- `types.ts` — explicit TypeScript types derived from the contract spec
  (argument and return types for each selected method).
- `invoke.ts` — a typed invocation example that builds the transaction
  arguments explicitly and hands them to `submitWithRestore`.

```typescript
// types.ts (generated — inspect and edit freely)
export interface TransferArgs {
  from: string
  to: string
  amount: bigint
}

export interface TransferResult {
  ok: boolean
}
```

```typescript
// invoke.ts (generated — inspect and edit freely)
import type { TransferArgs, TransferResult } from './types'
import { SorobanResurrect } from '@soroban-resurrect/sdk'

export async function invokeTransfer(
  sr: SorobanResurrect,
  args: TransferArgs,
): Promise<TransferResult> {
  // Transaction arguments are explicit and inspectable:
  const tx = await sr.buildInvocation({
    contractId: 'C...ABC',
    method: 'transfer',
    args: [args.from, args.to, args.amount],
  })

  const result = await sr.submitWithRestore({ transaction: tx, wallet })
  if (!result.success) throw result.error ?? new Error('Invocation failed')
  return result.returnValue as TransferResult
}
```

### Boundary and failure behavior

- If `--out` already exists and is non-empty, the command fails unless `--force`
  is passed. This prevents silently clobbering hand-edited generated files.
- If `--contract-id` cannot be resolved against the configured RPC, the command
  exits non-zero with the RPC error and writes nothing.
- If `--methods` names a method that is not present in the contract spec, the
  command exits non-zero and lists the unknown methods; no files are written.
- Generated files are never overwritten by later SDK upgrades — regeneration is
  always an explicit `scaffold contract` run.

### Compatibility / migration notes

- This workflow is additive and opt-in; existing projects are unaffected and no
  migration is required.
- Generated files are ordinary source files. Commit them, review them, and edit
  them like any other code — they are not regenerated automatically.
- If you previously hand-wrote invocation wrappers, you can keep them; the
  scaffolder is a starting point, not a replacement.

More end-to-end walkthroughs live in the [Tutorial](/guide/tutorial).
