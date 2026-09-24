import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    typecheck: {
      include: ['src/**/*.test-d.ts'],
      ignoreSourceErrors: true,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        branches: 80,
        lines: 90,
      },
    },
  },
})
