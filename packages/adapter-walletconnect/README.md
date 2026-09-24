# @soroban-resurrect/adapter-walletconnect

[`WalletAdapter`](../sdk) implementation over a **Stellar
[WalletConnect v2](https://walletconnect.com)** session.

The four browser-extension adapters (Freighter, Albedo, LOBSTR, xBull) don't
help mobile users. This adapter lets any mobile-first Stellar wallet that speaks
WalletConnect v2 sign the SDK's restore and original transactions, so a dApp can
support mobile pairing with the same code path as desktop.

## Install

```bash
npm install @soroban-resurrect/adapter-walletconnect @soroban-resurrect/sdk
npm install @walletconnect/sign-client   # optional peer: your app usually owns this
```

`@walletconnect/sign-client` is an **optional peer dependency** — the adapter
only needs a structurally-compatible `client` and `session`, so a shared
connector or a mock (in CI) works too.

## Pairing flow (mobile + desktop)

The adapter does not own the pairing lifecycle. Your app creates and approves the
session, then hands the connected client + session to the adapter.

```ts
import SignClient from '@walletconnect/sign-client'
import { SorobanResurrect } from '@soroban-resurrect/sdk'
import { WalletConnectAdapter } from '@soroban-resurrect/adapter-walletconnect'

const client = await SignClient.init({
  projectId: process.env.WC_PROJECT_ID,
  metadata: {
    name: 'My Soroban dApp',
    description: 'Cross-contract state restoration',
    url: 'https://example.com',
    icons: ['https://example.com/icon.png'],
  },
})

const { uri, approval } = await client.connect({
  requiredNamespaces: {
    stellar: {
      chains: ['stellar:testnet'],       // or 'stellar:pubnet'
      methods: ['stellar_signXDR'],
      events: [],
    },
  },
})

// Desktop: render `uri` as a QR code.
// Mobile: open `uri` as a deep link (`window.location.href = uri`).
const session = await approval()

const sr = new SorobanResurrect({ rpcUrl: 'https://soroban-testnet.stellar.org' })
const wallet = new WalletConnectAdapter({
  client,
  session,
  networkPassphrase: 'Test SDF Network ; September 2015',
})

const result = await sr.submitWithRestore({ transaction, wallet })
```

### Session verification

The constructor validates the approved session before any signing:

- the `stellar` namespace must grant at least one account,
- one of those accounts must be on the CAIP-2 chain that matches
  `networkPassphrase` (`stellar:pubnet` vs `stellar:testnet`) — a mismatch throws
  rather than producing signatures for the wrong network,
- the `stellar_signXDR` method must be granted.

## API

| Member | Description |
| --- | --- |
| `isConnected()` | `true` while the session topic and resolved account are present. |
| `getPublicKey()` | Returns the verified account from the session as a `StellarPublicKey`. |
| `signTransaction(xdr)` | Sends a `stellar_signXDR` JSON-RPC request over the relay and returns the `signedXDR` as `XdrBase64`. Relay/user-rejection errors are normalized to `WalletConnect: …`. |
| `capabilities` | `{ signAuthEntry: false, feeBump: true }` |

## Testing

`npm test` runs `vitest` against a mocked `SignClient` — no relay required.
See [`src/__tests__/WalletConnectAdapter.test.ts`](./src/__tests__/WalletConnectAdapter.test.ts).
In CI the WalletConnect v2 relay is stubbed by the same mock client.
