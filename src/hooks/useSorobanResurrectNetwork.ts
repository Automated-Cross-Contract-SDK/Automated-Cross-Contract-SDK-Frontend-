import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SorobanResurrect,
  SorobanResurrectOptions,
  SorobanResurrectNetwork,
} from '../core/SorobanResurrect';

export interface UseSorobanResurrectNetworkOptions extends SorobanResurrectOptions {
  /**
   * The network to resurrect against. Changing this value switches the
   * underlying instance in place, preserving transaction history, the
   * simulation cache, and any listening subscribers.
   */
  network: SorobanResurrectNetwork;
  /**
   * Called exactly once per committed network change with the (same)
   * instance now bound to the new network. A no-op switch to the current
   * network does not fire this callback.
   */
  onSwitch?: (instance: SorobanResurrect, network: SorobanResurrectNetwork) => void;
}

export interface UseSorobanResurrectNetworkResult {
  /**
   * The resurrect instance. It is eagerly constructed on the first render,
   * so it is always non-null.
   */
  resurrect: SorobanResurrect;
  /** The network the instance is currently bound to. */
  network: SorobanResurrectNetwork;
  /** Switch to a new network, preserving history and listeners. */
  switchNetwork: (network: SorobanResurrectNetwork) => void;
}

/**
 * React hook that binds a {@link SorobanResurrect} instance to a network and
 * keeps it in sync as the requested network changes.
 *
 * Unlike a naive `useMemo` keyed on the network, this hook reuses the same
 * instance and calls its own `switchNetwork()` so that transaction history,
 * the simulation cache, and any listening subscribers survive the switch.
 */
export function useSorobanResurrectNetwork(
  options: UseSorobanResurrectNetworkOptions,
): UseSorobanResurrectNetworkResult {
  const { network, onSwitch, ...resurrectOptions } = options;

  // Eagerly construct the instance so the returned value is never null on the
  // first render. The instance is created once and reused across switches.
  const instanceRef = useRef<SorobanResurrect | null>(null);
  if (instanceRef.current === null) {
    instanceRef.current = new SorobanResurrect({ ...resurrectOptions, network });
  }

  const [committedNetwork, setCommittedNetwork] = useState<SorobanResurrectNetwork>(
    instanceRef.current.network,
  );

  // Keep the latest options available without recreating the instance.
  const optionsRef = useRef(resurrectOptions);
  optionsRef.current = resurrectOptions;

  const switchNetwork = useCallback((next: SorobanResurrectNetwork) => {
    const instance = instanceRef.current;
    if (instance === null) {
      return;
    }
    // A no-op switch to the current network must not fire any event.
    if (instance.network === next) {
      return;
    }
    instance.switchNetwork(next);
    setCommittedNetwork(next);
  }, []);

  // Observe the requested network and switch the instance in place. This runs
  // after commit, so `onSwitch` is never fired from inside a state updater.
  useEffect(() => {
    const instance = instanceRef.current;
    if (instance === null) {
      return;
    }
    if (instance.network === network) {
      return;
    }
    instance.switchNetwork(network);
    setCommittedNetwork(network);
  }, [network]);

  // Fire `onSwitch` exactly once per committed network change, observing the
  // committed value rather than the requested one.
  const onSwitchRef = useRef(onSwitch);
  onSwitchRef.current = onSwitch;
  const isFirstCommit = useRef(true);
  useEffect(() => {
    if (isFirstCommit.current) {
      isFirstCommit.current = false;
      return;
    }
    const instance = instanceRef.current;
    if (instance === null) {
      return;
    }
    onSwitchRef.current?.(instance, committedNetwork);
  }, [committedNetwork]);

  return useMemo(
    () => ({
      resurrect: instanceRef.current as SorobanResurrect,
      network: committedNetwork,
      switchNetwork,
    }),
    [committedNetwork, switchNetwork],
  );
}
