import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.ts'],
    globals: true,
    passWithNoTests: true,
    typecheck: {
      include: ['src/**/*.test-d.ts'],
      tsconfig: './tsconfig.typecheck.json',
      ignoreSourceErrors: true,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
})
