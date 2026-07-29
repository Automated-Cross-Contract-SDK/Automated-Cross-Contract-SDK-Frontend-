import React, { useState, useCallback } from 'react'
import {
  View,
  Text,
  Button,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native'
import { useSorobanResurrect } from '@soroban-resurrect/react-hook'
import { TransactionBuilder, Operation, Networks, nativeToScVal } from '@stellar/stellar-sdk'

// Note: In a real React Native app, you would use a wallet adapter that
// wraps a mobile wallet like Lobstr or xBull instead of Freighter.
// The useSorobanResurrect hook works identically in React Native as in web —
// no browser-specific APIs are used.

const RPC_URL = 'https://soroban-testnet.stellar.org'
const NETWORK = Networks.TESTNET
const CONTRACT_ID = 'CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q'

type WalletAdapter = {
  isConnected: () => Promise<boolean>
  getPublicKey: () => Promise<string>
  signTransaction: (tx: string, opts?: { networkPassphrase?: string }) => Promise<string>
}

interface SorobanDemoProps {
  wallet: WalletAdapter
  publicKey: string
}

function SorobanDemo({ wallet, publicKey }: SorobanDemoProps) {
  const { state, isProcessing, submitWithRestore, detectArchivedKeys, reset, resurrect } =
    useSorobanResurrect({
      config: { rpcUrl: RPC_URL, networkPassphrase: NETWORK },
    })

  const [lastResult, setLastResult] = useState<string | null>(null)

  const buildSampleTransaction = useCallback(async () => {
    const sdkServer = resurrect.server
    const account = await sdkServer.getAccount(publicKey)

    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: NETWORK,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: CONTRACT_ID,
          function: 'withdraw',
          args: [nativeToScVal(1000, { type: 'i128' })],
        }),
      )
      .setTimeout(30)
      .build()

    return tx
  }, [publicKey, resurrect])

  const handleSubmit = useCallback(async () => {
    setLastResult(null)
    try {
      const tx = await buildSampleTransaction()
      const result = await submitWithRestore(tx, wallet)
      setLastResult(JSON.stringify(result, null, 2))
    } catch (err) {
      setLastResult(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [submitWithRestore, buildSampleTransaction, wallet])

  const handleCheckArchived = useCallback(async () => {
    try {
      const tx = await buildSampleTransaction()
      const keys = await detectArchivedKeys(tx)
      if (keys.length === 0) {
        alert('No archived keys detected.')
      } else {
        alert(`Detected ${keys.length} archived ledger entries.`)
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [detectArchivedKeys, buildSampleTransaction])

  const statusColor = (() => {
    switch (state.state) {
      case 'error':
        return '#dc3545'
      case 'success':
        return '#28a745'
      case 'restore_needed':
        return '#ffc107'
      default:
        return '#6c757d'
    }
  })()

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Soroban-Resurrect React Native Demo</Text>

      <Text style={styles.subtitle}>
        Connected:{' '}
        <Text style={styles.code}>
          {publicKey.slice(0, 8)}...{publicKey.slice(-4)}
        </Text>
      </Text>

      <View style={styles.buttonRow}>
        <Button title="Check Archived Keys" onPress={handleCheckArchived} disabled={isProcessing} />
        <View style={styles.spacer} />
        <Button title={isProcessing ? 'Processing...' : 'Submit Withdraw'} onPress={handleSubmit} disabled={isProcessing} />
      </View>

      {(state.state !== 'idle' || lastResult) && (
        <View style={styles.buttonRow}>
          <Button title="Reset" onPress={() => reset()} />
        </View>
      )}

      {state.message ? (
        <View style={[styles.statusBox, { borderColor: statusColor }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>
            <Text style={styles.bold}>Status:</Text> {state.message}
          </Text>
        </View>
      ) : null}

      {isProcessing ? <ActivityIndicator size="large" style={styles.spinner} /> : null}

      {state.archivedKeys && state.archivedKeys.length > 0 ? (
        <Text style={styles.archivedText}>
          Archived entries detected: {state.archivedKeys.length}
        </Text>
      ) : null}

      {lastResult ? (
        <View style={styles.resultBox}>
          <Text style={styles.resultText}>{lastResult}</Text>
        </View>
      ) : null}
    </ScrollView>
  )
}

export default function App() {
  // In a real app, connect to a mobile wallet and pass the adapter here
  const [connected, setConnected] = useState(false)

  return (
    <View style={styles.root}>
      {!connected ? (
        <View style={styles.connectContainer}>
          <Text style={styles.title}>Connect Your Wallet</Text>
          <Button title="Connect Wallet" onPress={() => setConnected(true)} />
        </View>
      ) : (
        <SorobanDemo
          wallet={
            {
              isConnected: async () => true,
              getPublicKey: async () => 'G...',
              signTransaction: async (tx: string) => tx,
            }
          }
          publicKey="GABCDEF1234567890ABCDEF1234567890ABCDEF"
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fff',
  },
  connectContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  container: {
    padding: 24,
    paddingTop: 60,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 20,
    color: '#555',
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 13,
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  spacer: {
    width: 8,
  },
  statusBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 4,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 14,
  },
  bold: {
    fontWeight: '700',
  },
  spinner: {
    marginTop: 20,
  },
  archivedText: {
    marginTop: 12,
    fontSize: 13,
    color: '#888',
  },
  resultBox: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 4,
  },
  resultText: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
})
