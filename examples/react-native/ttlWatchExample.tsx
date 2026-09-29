/**
 * React Native: proactive TTL watch-and-extend that survives app backgrounding.
 *
 * - Polls `getExpiringSoonEntries()` on an interval while the app is active.
 * - Pauses polling when `AppState` leaves `active` (iOS/Android suspend JS
 *   timers anyway — pausing avoids a burst of stale ticks on resume) and
 *   polls immediately on return to the foreground.
 * - Shows a warning banner when entries cross the threshold and extends them
 *   only after the user confirms, via `restoreKeys()`.
 *
 * No `window` / `document` is touched — only React Native APIs. The Node
 * polyfills in `index.js` must run before this module is imported.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, SafeAreaView, Text, TouchableOpacity, StyleSheet, View } from 'react-native'
import {
  SorobanResurrect,
  type LedgerEntryTTLInfo,
  type WalletAdapter,
} from '@soroban-resurrect/sdk'
import { Networks, xdr } from '@stellar/stellar-sdk'

const RPC_URL = 'https://soroban-testnet.stellar.org'
const POLL_INTERVAL_MS = 60_000
const THRESHOLD_LEDGERS = 17_280 // ~24 h at 5 s/ledger

interface Props {
  wallet: WalletAdapter
  /** Ledger keys to watch (e.g. the user's position entries). */
  keys: xdr.LedgerKey[]
}

export default function TTLWatchExample({ wallet, keys }: Props) {
  const sdk = useMemo(
    () => new SorobanResurrect({ rpcUrl: RPC_URL, networkPassphrase: Networks.TESTNET }),
    [],
  )
  const [expiring, setExpiring] = useState<LedgerEntryTTLInfo[]>([])
  const [status, setStatus] = useState('Watching…')
  const [extending, setExtending] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    try {
      setExpiring(await sdk.getExpiringSoonEntries(keys, THRESHOLD_LEDGERS))
    } catch (err) {
      setStatus(`Poll failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [sdk, keys])

  useEffect(() => {
    const start = () => {
      if (timer.current) return
      void poll()
      timer.current = setInterval(poll, POLL_INTERVAL_MS)
    }
    const stop = () => {
      if (timer.current) clearInterval(timer.current)
      timer.current = null
    }

    if (AppState.currentState === 'active') start()
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        setStatus('Watching…')
        start()
      } else {
        setStatus('Paused (app in background)')
        stop()
      }
    })
    return () => {
      sub.remove()
      stop()
    }
  }, [poll])

  const extend = useCallback(async () => {
    setExtending(true)
    try {
      const toExtend = keys.filter((k) => expiring.some((e) => e.keyBase64 === k.toXDR('base64')))
      const result = await sdk.restoreKeys(toExtend, wallet)
      setStatus(result.success ? 'Extended ✓' : 'Extend failed')
      await poll()
    } catch (err) {
      setStatus(`Extend failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExtending(false)
    }
  }, [sdk, wallet, keys, expiring, poll])

  return (
    <SafeAreaView style={styles.container}>
      {expiring.length > 0 && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {expiring.length} entr{expiring.length === 1 ? 'y' : 'ies'} expiring soon (min{' '}
            {Math.min(...expiring.map((e) => e.ttlLedgers))} ledgers left)
          </Text>
          <TouchableOpacity style={styles.button} onPress={extend} disabled={extending}>
            <Text style={styles.buttonText}>{extending ? 'Extending…' : 'Extend now'}</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text>{status}</Text>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  banner: { backgroundColor: '#fff3cd', borderRadius: 8, padding: 12, marginBottom: 12 },
  bannerText: { color: '#664d03', marginBottom: 8 },
  button: { backgroundColor: '#664d03', borderRadius: 6, padding: 10, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
})
