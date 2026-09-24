import { ConnectWallet } from './connect-wallet'
import { ServerRestoreStatus } from './server-restore-status'

interface PageProps {
  searchParams: { account?: string | string[] }
}

export default function Page({ searchParams }: PageProps) {
  const rawAccount = searchParams.account
  const account = Array.isArray(rawAccount) ? rawAccount[0] : rawAccount

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Soroban-Resurrect – Next.js App Router Example</h1>
      <p>
        Demonstrates the App Router pattern: the Server Component runs <code>needsRestore()</code>{' '}
        and <code>estimateRestoreCost()</code> against a server-only RPC endpoint and passes the
        result to the client, which ships only the restore flow.
      </p>

      <ConnectWallet account={account ?? null} />

      {account ? (
        <ServerRestoreStatus account={account} />
      ) : (
        <p>
          Connect a Freighter wallet to run archive detection on the server for its withdraw
          transaction.
        </p>
      )}
    </main>
  )
}
