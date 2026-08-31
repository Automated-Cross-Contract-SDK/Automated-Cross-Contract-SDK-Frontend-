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
  // Bundle JSON config files so defaults.json is inlined into the dist output.
  // This means consumers don't need to ship the JSON separately.
  loader: { '.json': 'json' },
})
