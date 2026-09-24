import { detectRestoreForAccount, type ServerRestoreDetection } from './lib/server-config'
import { RestoreButton } from './restore-button'

/**
 * Server Component: runs archive detection against the server-only RPC and
 * passes the result down to the client restore flow as props.
 *
 * None of the SDK detection code imported here is included in the client
 * bundle — Next.js keeps Server Component imports on the server. The client
 * only receives the `needsRestore` flag, the serializable fee estimate, and
 * the account it already knows about.
 */
export async function ServerRestoreStatus({ account }: { account: string }) {
  let detection: ServerRestoreDetection
  try {
    detection = await detectRestoreForAccount(account)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return (
      <section style={{ marginTop: 24 }}>
        <h2>Server-side archive check</h2>
        <p role="alert">Could not check archive status: {message}</p>
      </section>
    )
  }

  const { needsRestore, estimate } = detection

  return (
    <section style={{ marginTop: 24 }}>
      <h2>Server-side archive check</h2>

      <p>
        Rendered on the server against <code>SOROBAN_RPC_URL</code>:{' '}
        <strong>{needsRestore ? 'restore required' : 'ready to submit'}</strong>
      </p>

      {estimate && (
        <p>
          Estimated restore fee (server-side): <strong>{estimate.estimatedFee} stroops</strong> for{' '}
          {estimate.archivedKeysDetected} archived{' '}
          {estimate.archivedKeysDetected === 1 ? 'entry' : 'entries'} ({estimate.multiplier}×
          multiplier).
        </p>
      )}

      <RestoreButton account={account} needsRestore={needsRestore} />
    </section>
  )
}
