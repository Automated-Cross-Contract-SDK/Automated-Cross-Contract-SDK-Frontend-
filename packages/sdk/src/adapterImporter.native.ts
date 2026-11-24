import type { AdapterImporter } from './adapterImporter.js'

/**
 * React Native variant, swapped in by tsup.config.ts. Metro refuses to bundle
 * non-literal `import()` calls, so callers must supply their own importer.
 */
export const defaultImporter: AdapterImporter = (pkg) =>
  Promise.reject(
    new Error(
      `Dynamic imports are unavailable in React Native; pass an importer, e.g. createAdapter(name, opts, () => import('${pkg}'))`,
    ),
  )
