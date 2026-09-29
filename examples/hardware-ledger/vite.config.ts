import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `vite --mode mock` swaps the Ledger Stellar app for an in-browser mock, so
// `LedgerWalletAdapter` runs its real connect/sign code without a device.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias:
      mode === 'mock'
        ? {
            '@ledgerhq/hw-app-str': fileURLToPath(
              new URL('./src/mock/MockStellarApp.ts', import.meta.url),
            ),
          }
        : {},
  },
}))
