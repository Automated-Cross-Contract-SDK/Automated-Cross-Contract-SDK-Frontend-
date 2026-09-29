# WalletConnect

Adapter over a Stellar [WalletConnect v2](https://walletconnect.com) session, enabling
mobile wallets that speak WalletConnect.

## Install

```bash
npm install @soroban-resurrect/adapter-walletconnect @walletconnect/sign-client
```

`@walletconnect/sign-client` is an optional peer dependency — you own the pairing lifecycle.

## Project ID (required)

WalletConnect requires a **project ID** from [WalletConnect Cloud](https://cloud.walletconnect.com).
Expose it through your bundler's public env convention, for example:

```bash
# Vite
VITE_WALLETCONNECT_PROJECT_ID=your-project-id
# Next.js
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your-project-id
```

## Connection flow

1. `SignClient.init({ projectId })` creates the client.
2. `client.connect({ requiredNamespaces })` returns a pairing `uri` and an `approval()` promise.
3. Show `uri` as a QR code or deep link; the user approves in their mobile wallet.
4. `await approval()` yields the session; hand `client` + `session` to the adapter.

```ts
import SignClient from '@walletconnect/sign-client'
import { WalletConnectAdapter } from '@soroban-resurrect/adapter-walletconnect'

const client = await SignClient.init({ projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID })
const { uri, approval } = await client.connect({
  requiredNamespaces: {
    stellar: { chains: ['stellar:testnet'], methods: ['stellar_signXDR'], events: [] },
  },
})
showQrCode(uri)
const session = await approval()

const wallet = new WalletConnectAdapter({
  client,
  session,
  networkPassphrase: 'Test SDF Network ; September 2015',
})
const result = await sr.submitWithRestore({ transaction, wallet })
```

## Constructor options

| Option              | Type                         | Required | Description                                                             |
| ------------------- | ---------------------------- | -------- | ----------------------------------------------------------------------- |
| `client`            | `WalletConnectSignClientLike` | ✅       | A connected `SignClient` (or compatible stub).                          |
| `session`           | `WalletConnectSessionLike`    | ✅       | An approved session for this dApp.                                      |
| `networkPassphrase` | `string`                     | ✅       | Selects the CAIP-2 chain and checks the session granted an account on it. |
| `namespace`         | `string`                     | —        | Namespace key, defaults to `"stellar"`.                                 |

The constructor throws if `client`/`session` are missing or the session has no account on the
requested network.

## SSR / browser constraints

Initialise `SignClient` and the adapter on the client only; the pairing relay uses browser
WebSockets and storage. Keep it out of server components and SSR code paths.

Capabilities: `signAuthEntry: false`, `feeBump: true`.
