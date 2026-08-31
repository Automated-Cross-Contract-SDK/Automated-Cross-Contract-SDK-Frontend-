/**
 * React Native: persist transaction history so `retry(historyId)` survives an
 * app kill.
 *
 * SDK history normally lives in memory (`TransactionHistory`), so on mobile an
 * app restart wipes it and a failed restore can no longer be retried. Passing
 * `persistHistory` with an AsyncStorage-backed store fixes that:
 *
 *   1. On construction the SDK hydrates `TransactionHistory` from storage.
 *   2. Every history change (add / update / retry) is written back.
 *   3. `await sdk.ready` resolves once hydration has finished.
 *
 * Install the peer dependency in a real project:
 *   npm i @react-native-async-storage/async-storage
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { SafeAreaView, ScrollView, Text, TouchableOpacity, StyleSheet } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { SorobanResurrect, type ResurrectResult, type WalletAdapter } from '@soroban-resurrect/sdk'
import { Networks, TransactionBuilder } from '@stellar/stellar-sdk'

const RPC_URL = 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = Networks.TESTNET

// One SDK instance for the whole app. `persistHistory.storage` accepts any
// AsyncStorage-compatible object ({ getItem, setItem }); `localStorage` and
// `sessionStorage` work in web builds too.
const sdk = new SorobanResurrect({
  rpcUrl: RPC_URL,
  networkPassphrase: NETWORK_PASSPHRASE,
  persistHistory: {
    storage: AsyncStorage,
    key: 'demo:soroban-history', // optional, defaults to 'soroban-resurrect:history'
  },
})

export function PersistHistoryScreen({ wallet }: { wallet: WalletAdapter }) {
  const [hydrated, setHydrated] = useState(false)
  const [entries, setEntries] = useState<ReturnType<typeof sdk.getHistory>>([])
  const [log, setLog] = useState<string[]>([])
  const append = (line: string) => setLog((prev) => [line, ...prev])
  const lastHistoryId = useRef<string | null>(null)

  // Wait for the persisted history to hydrate before reading it. After an app
  // relaunch this repopulates `getHistory()` with prior attempts.
  useEffect(() => {
    sdk.ready.then(() => {
      setHydrated(true)
      setEntries(sdk.getHistory())
      const failed = sdk.getHistory().find((e) => e.status === 'failed')
      if (failed) {
        lastHistoryId.current = failed.id
        append(`Recovered failed attempt ${failed.id} from storage — retry available`)
      }
    })
  }, [])

  const submit = useCallback(async () => {
    const account = await sdk.server.getAccount(await wallet.getPublicKey())
    const transaction = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .setTimeout(30)
      .build()

    const result: ResurrectResult = await sdk.submitWithRestore({ transaction, wallet })
    lastHistoryId.current = result.historyId ?? null
    setEntries(sdk.getHistory()) // persisted automatically
    append(`submit → success=${result.success} historyId=${result.historyId}`)
  }, [wallet])

  // Works even if the app was killed between submit and retry: after relaunch,
  // `sdk.ready` rehydrates history and this id resolves to the stored entry.
  const retry = useCallback(async () => {
    if (!lastHistoryId.current) return
    const result = await sdk.retry(lastHistoryId.current, wallet)
    setEntries(sdk.getHistory())
    append(`retry(${lastHistoryId.current}) → success=${result.success}`)
  }, [wallet])

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Persisted history + offline retry</Text>
        <Text>Hydrated from AsyncStorage: {hydrated ? 'yes' : '…'}</Text>
        <Text style={styles.h2}>Stored attempts ({entries.length})</Text>
        {entries.map((e) => (
          <Text key={e.id} style={styles.mono}>
            {e.id} · {e.status} · attempts={e.attemptCount}
          </Text>
        ))}

        <TouchableOpacity style={styles.button} onPress={submit}>
          <Text style={styles.buttonText}>Submit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={retry}>
          <Text style={styles.buttonText}>Retry last (survives restart)</Text>
        </TouchableOpacity>

        {log.map((line, i) => (
          <Text key={i} style={styles.mono}>
            {line}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { padding: 24, gap: 8 },
  title: { fontSize: 20, fontWeight: '600' },
  h2: { fontSize: 16, fontWeight: '600', marginTop: 12 },
  mono: { fontFamily: 'monospace', fontSize: 12 },
  button: {
    backgroundColor: '#007bff',
    borderRadius: 6,
    padding: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
})
