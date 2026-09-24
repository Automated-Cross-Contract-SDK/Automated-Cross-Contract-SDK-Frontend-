'use client'

import type { ReactNode } from 'react'
import { SorobanResurrectProvider } from '@soroban-resurrect/react-hook'
import { CLIENT_NETWORK_PASSPHRASE, CLIENT_RPC_URL } from './lib/client-config'

// SorobanResurrectProvider relies on React context, so it (and everything
// that reads from it) must live inside a client component boundary in the
// App Router. Keep this file as the single 'use client' seam and let
// app/layout.tsx stay a server component.
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SorobanResurrectProvider
      config={{ rpcUrl: CLIENT_RPC_URL, networkPassphrase: CLIENT_NETWORK_PASSPHRASE }}
    >
      {children}
    </SorobanResurrectProvider>
  )
}
