import { describe, expect, it } from 'vitest'
import * as sdk from '../index.js'
import manifest from '../../package.json' with { type: 'json' }
import fixture from '../../api-compatibility.json' with { type: 'json' }

describe('SDK package compatibility fixture', () => {
  it('keeps the documented package entry points stable', () => {
    expect(manifest.exports).toEqual(fixture.entryPoints)
    expect(manifest.main).toBe(fixture.entryPoints['.'].import)
    expect(manifest.types).toBe(fixture.entryPoints['.'].types)
  })

  // TODO(known-failing): feature lost in bad merges; see docs/known-failing-tests.md
  it.skip('keeps every fixture runtime export on the public barrel', () => {
    const actual = new Set(Object.keys(sdk))
    const missing = fixture.runtimeExports.filter((name) => !actual.has(name))

    expect(missing).toEqual([])
  })
})
