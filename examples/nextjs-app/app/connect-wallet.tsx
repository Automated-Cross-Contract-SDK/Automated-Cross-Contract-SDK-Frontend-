'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getFreighterApi } from './lib/freighter'

interface ConnectWalletProps {
  /** Account currently in the URL, if any. */
  account: string | null
}

/**
 * Client Component that connects Freighter and reflects the account in the
 * URL. Updating the query string re-runs the Server Component (see
 * `page.tsx`) so archive detection happens server-side for the connected
 * account.
 */
export function ConnectWallet({ account }: ConnectWalletProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  const connect = useCallback(async () => {
    setError(null)
    const freighter = getFreighterApi()
    if (!freighter) {
      setError('Freighter wallet not found. Install the extension and try again.')
      return
    }

    try {
      const { address } = await freighter.getAddress()
      router.push(`/?account=${encodeURIComponent(address)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [router])

  if (account) {
    return (
      <p>
        Connected:{' '}
        <code>
          {account.slice(0, 8)}…{account.slice(-4)}
        </code>{' '}
        <button onClick={() => router.push('/')}>Disconnect</button>
      </p>
    )
  }

  return (
    <div>
      <button onClick={connect}>Connect Freighter Wallet</button>
      {error && (
        <p role="alert" style={{ color: '#b00020' }}>
          {error}
        </p>
      )}
    </div>
  )
}
