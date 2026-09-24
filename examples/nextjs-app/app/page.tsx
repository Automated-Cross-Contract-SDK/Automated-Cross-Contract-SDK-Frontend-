import { WithdrawCard } from './withdraw-card'

export default function Page() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Soroban-Resurrect – Next.js App Router Example</h1>
      <p>
        Demonstrates wiring <code>@soroban-resurrect/react-hook</code>&apos;s{' '}
        <code>SorobanResurrectProvider</code> into a Next.js 14 App Router layout, with the
        provider and its consumers isolated behind a single <code>&quot;use client&quot;</code>{' '}
        boundary.
      </p>
      <WithdrawCard />
    </main>
  )
}
