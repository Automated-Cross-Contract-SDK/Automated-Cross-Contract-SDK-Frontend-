import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SorobanResurrect,
  SorobanResurrectNetwork,
  isProcessingState,
  type RestoreStateInfo,
  type SorobanNetworkName,
  type SorobanNetworkPreset,
  type SorobanResurrectConfig,
} from '@soroban-resurrect/sdk'

/** A preset entry as returned by `SorobanResurrectNetwork.listPresets()`. */
export type NetworkPresetEntry = SorobanNetworkPreset & { name: SorobanNetworkName }

/** Options for `useSorobanResurrectNetwork`. */
export interface UseSorobanResurrectNetworkOptions {
  /** Network to start on. Defaults to `'testnet'`. */
  initialNetwork?: SorobanNetworkName
  /**
   * Extra config overrides applied to every network (polling settings,
   * fee multiplier, …). `rpcUrl` / `networkPassphrase` come from the preset.
   */
  overrides?: Partial<Omit<SorobanResurrectConfig, 'rpcUrl' | 'networkPassphrase'>>
  /** Called after the active network changes. */
  onSwitch?: (network: SorobanNetworkName, instance: SorobanResurrect) => void
}

/** Return value of `useSorobanResurrectNetwork`. */
export interface UseSorobanResurrectNetworkReturn {
  /** The active network name. */
  network: SorobanNetworkName
  /** All available presets, for populating a network selector. */
  presets: NetworkPresetEntry[]
  /** The active network's preset (rpcUrl, passphrase, displayName). */
  current: NetworkPresetEntry
  /** SDK instance bound to the active network. */
  resurrect: SorobanResurrect
  /** Live workflow state of the active instance. */
  state: RestoreStateInfo
  /** Whether the active instance is mid-operation. */
  isProcessing: boolean
  /** Swap the active network. No-op if `name` is already active. */
  switchNetwork: (name: SorobanNetworkName) => void
}

/**
 * Manages the active Stellar network for a `SorobanResurrect` instance from
 * the UI, so a network switch does not force consumers to rebuild their
 * provider config and lose state.
 *
 * On `switchNetwork`, a fresh instance is created for the target network and
 * the hook re-attaches its `onStateChange` subscription, so a component
 * observing `state` keeps working across the switch without re-subscribing.
 *
 * @example
 * ```tsx
 * function NetworkPicker() {
 *   const { network, presets, switchNetwork } = useSorobanResurrectNetwork()
 *   return (
 *     <select value={network} onChange={(e) => switchNetwork(e.target.value as any)}>
 *       {presets.map((p) => <option key={p.name} value={p.name}>{p.displayName}</option>)}
 *     </select>
 *   )
 * }
 * ```
 */
export function useSorobanResurrectNetwork(
  options: UseSorobanResurrectNetworkOptions = {},
): UseSorobanResurrectNetworkReturn {
  const { initialNetwork = 'testnet', overrides } = options

  const presets = useMemo(() => SorobanResurrectNetwork.listPresets(), [])
  const overridesKey = overrides ? JSON.stringify(overrides) : ''

  const [network, setNetwork] = useState<SorobanNetworkName>(initialNetwork)
  const [state, setState] = useState<RestoreStateInfo>({ state: 'idle', message: '' })

  const instanceRef = useRef<SorobanResurrect | null>(null)
  const keyRef = useRef<string>('')

  const key = `${network}::${overridesKey}`
  if (!instanceRef.current || keyRef.current !== key) {
    keyRef.current = key
    instanceRef.current = SorobanResurrectNetwork.create(network, overrides)
  }

  const optsRef = useRef(options)
  optsRef.current = options

  useEffect(() => {
    const instance = instanceRef.current!
    setState(instance.stateInfo ?? { state: 'idle', message: '' })
    const unsub = instance.onStateChange((info) => setState(info))
    return unsub
  }, [key])

  const switchNetwork = useCallback(
    (name: SorobanNetworkName) => {
      setNetwork((prev) => {
        if (prev === name) return prev
        // The instance + subscription are rebuilt by the render + effect
        // above once `network` changes; notify listeners afterwards.
        queueMicrotask(() => {
          if (instanceRef.current) optsRef.current.onSwitch?.(name, instanceRef.current)
        })
        return name
      })
    },
    [],
  )

  const current = useMemo(
    () => presets.find((p) => p.name === network) ?? presets[0],
    [presets, network],
  )

  return {
    network,
    presets,
    current,
    resurrect: instanceRef.current,
    state,
    isProcessing: isProcessingState(state.state),
    switchNetwork,
  }
}
