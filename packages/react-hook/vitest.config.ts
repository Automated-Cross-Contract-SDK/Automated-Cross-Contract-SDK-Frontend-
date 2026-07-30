import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
})
