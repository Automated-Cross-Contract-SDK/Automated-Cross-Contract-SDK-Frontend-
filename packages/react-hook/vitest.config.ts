import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    typecheck: {
      include: ['src/**/*.test-d.ts'],
      tsconfig: './tsconfig.typecheck.json',
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
