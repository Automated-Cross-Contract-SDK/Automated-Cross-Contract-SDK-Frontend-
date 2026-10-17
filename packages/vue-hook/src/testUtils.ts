import { createApp, type App } from 'vue'

/**
 * Runs a composable inside a real (headless) Vue app instance so that
 * component lifecycle hooks and scope cleanup fire. Call `app.unmount()` to
 * exercise cleanup.
 */
export function withSetup<T>(composable: () => T): [T, App] {
  let result!: T
  const app = createApp({
    setup() {
      result = composable()
      return () => null
    },
  })
  app.mount(document.createElement('div'))
  return [result, app]
}
