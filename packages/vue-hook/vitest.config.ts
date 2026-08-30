import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Node environment: guarantees the composable never reaches for DOM globals.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
  },
})
