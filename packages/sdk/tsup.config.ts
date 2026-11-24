import { fileURLToPath } from 'node:url'
import { defineConfig, type Options } from 'tsup'

const base: Options = {
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  // Not minified: consumers' bundlers do that, and minifying strips the
  // bundler-ignore hints on the dynamic import in createAdapter.ts.
  minify: false,
  clean: false,
  outDir: 'dist',
  splitting: false,
  treeshake: true,
  target: 'es2022',
  external: ['@stellar/stellar-sdk'],
  // Bundle JSON config files so defaults.json is inlined into the dist output.
  // This means consumers don't need to ship the JSON separately.
  loader: { '.json': 'json' },
}

export default defineConfig([
  base,
  {
    ...base,
    entry: { native: 'src/index.ts' },
    dts: false,
    esbuildPlugins: [
      {
        name: 'native-adapter-importer',
        setup(build) {
          build.onResolve({ filter: /\/adapterImporter\.js$/ }, () => ({
            path: fileURLToPath(new URL('./src/adapterImporter.native.ts', import.meta.url)),
          }))
        },
      },
    ],
  },
])
