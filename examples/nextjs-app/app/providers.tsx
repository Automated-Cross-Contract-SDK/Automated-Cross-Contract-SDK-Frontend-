'use client'

import type { ReactNode } from 'react'
import { SorobanResurrectProvider } from '@soroban-resurrect/react-hook'
import { Networks } from '@stellar/stellar-sdk'

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? Networks.TESTNET

// SorobanResurrectProvider relies on React context, so it (and everything
// that reads from it) must live inside a client component boundary in the
// App Router. Keep this file as the single 'use client' seam and let
// app/layout.tsx stay a server component.
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SorobanResurrectProvider config={{ rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE }}>
      {children}
    </SorobanResurrectProvider>
  )
}
