/**
 * Dynamic-import function used to load browser adapter packages. Injectable so
 * tests can supply a stub without the real packages being installed.
 */
export type AdapterImporter = (pkg: string) => Promise<Record<string, unknown>>

/** Loads an adapter package at runtime; bundlers are told to leave it alone. */
export const defaultImporter: AdapterImporter = (pkg) =>
  import(/* @vite-ignore */ /* webpackIgnore: true */ /* turbopackIgnore: true */ pkg) as Promise<
    Record<string, unknown>
  >
