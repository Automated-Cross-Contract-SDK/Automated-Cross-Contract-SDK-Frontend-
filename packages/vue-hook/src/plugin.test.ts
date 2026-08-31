import { describe, it, expect, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { SorobanResurrectPlugin, injectSorobanResurrect } from './plugin.js'

const instances: unknown[] = []

vi.mock('@soroban-resurrect/sdk', () => ({
  SorobanResurrect: vi.fn().mockImplementation((config: unknown) => {
    const inst = { config, marker: 'sdk-instance' }
    instances.push(inst)
    return inst
  }),
}))

const config = { rpcUrl: 'https://soroban-testnet.stellar.org' }

describe('SorobanResurrectPlugin', () => {
  it('provides a single shared instance consumable via injectSorobanResurrect()', () => {
    instances.length = 0
    let a: unknown
    let b: unknown

    const Child = defineComponent({
      setup() {
        b = injectSorobanResurrect()
        return () => h('div')
      },
    })
    const Root = defineComponent({
      setup() {
        a = injectSorobanResurrect()
        return () => h(Child)
      },
    })

    const app = createApp(Root)
    app.use(SorobanResurrectPlugin, { config })
    app.mount(document.createElement('div'))

    expect(a).toBeDefined()
    expect(a).toBe(b) // same instance across the tree
    expect(instances).toHaveLength(1) // constructed exactly once
  })

  it('throws a helpful error when config is missing', () => {
    const app = createApp(defineComponent({ render: () => h('div') }))
    expect(() => app.use(SorobanResurrectPlugin, undefined as never)).toThrow(/config` is required/)
  })

  it('injectSorobanResurrect() throws when the plugin was not installed', () => {
    let err: unknown
    const app = createApp(
      defineComponent({
        setup() {
          try {
            injectSorobanResurrect()
          } catch (e) {
            err = e
          }
          return () => h('div')
        },
      }),
    )
    app.mount(document.createElement('div'))
    expect((err as Error)?.message).toMatch(/plugin|install/i)
  })
})
