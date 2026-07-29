import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  minify: true,
  clean: true,
  outDir: 'dist',
  splitting: false,
  treeshake: true,
  target: 'es2022',
  external: ['@stellar/stellar-sdk'],
})
