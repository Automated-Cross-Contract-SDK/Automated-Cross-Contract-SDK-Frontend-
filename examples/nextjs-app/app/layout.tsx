import type { ReactNode } from 'react'
import { Providers } from './providers'

export const metadata = {
  title: 'Soroban-Resurrect – Next.js App Router Example',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
