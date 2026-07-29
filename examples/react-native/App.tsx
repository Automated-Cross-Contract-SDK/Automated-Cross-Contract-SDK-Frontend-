import React, { useCallback, useState } from 'react'
import {
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
} from 'react-native'
import { SorobanResurrectProvider, useSorobanResurrectContext } from '@soroban-resurrect/react-hook'
import {
  Keypair,
  TransactionBuilder,
  Operation,
  Networks,
  nativeToScVal,
} from '@stellar/stellar-sdk'
import type { WalletAdapter } from '@soroban-resurrect/sdk'

const RPC_URL = 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = Networks.TESTNET
const CONTRACT_ID = 'CCJZ5DGASBWQXR5G4GXEJM2Q4FI5L3QJ6TQ3QFJTQH7GJ6KJ3J2Q2K2Q'

// Demo-only wallet adapter that signs locally with a Keypair built from a
// pasted secret key. Real apps should integrate a proper mobile wallet
// (WalletConnect, a hardware wallet SDK, or a secure enclave-backed signer)
// instead of ever handling a raw secret key in app state.
function makeLocalWalletAdapter(secretKey: string): WalletAdapter {
  const keypair = Keypair.fromSecret(secretKey)
  return {
    isConnected: async () => true,
    getPublicKey: async () => keypair.publicKey(),
    signTransaction: async (xdr) => {
      const tx = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE)
      tx.sign(keypair)
      return tx.toXDR()
    },
  }
}

function WithdrawScreen() {
  const { resurrect, submitWithRestore, state, isProcessing } = useSorobanResurrectContext()
  const [secretKey, setSecretKey] = useState('')
  const [lastResult, setLastResult] = useState<string | null>(null)

  const handleWithdraw = useCallback(async () => {
    if (!secretKey || !resurrect) return
    setLastResult(null)

    try {
      const wallet = makeLocalWalletAdapter(secretKey)
      const publicKey = await wallet.getPublicKey()
      const account = await resurrect.server.getAccount(publicKey)

      const transaction = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: NETWORK_PASSPHRASE,
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

      const result = await submitWithRestore(transaction, wallet)
      setLastResult(JSON.stringify(result, null, 2))
    } catch (err) {
      setLastResult(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [secretKey, resurrect, submitWithRestore])

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Soroban-Resurrect – React Native Example</Text>

      <Text style={styles.label}>Testnet secret key (demo only)</Text>
      <TextInput
        style={styles.input}
        value={secretKey}
        onChangeText={setSecretKey}
        placeholder="S..."
        autoCapitalize="none"
        secureTextEntry
      />

      <TouchableOpacity
        style={[styles.button, (!secretKey || isProcessing) && styles.buttonDisabled]}
        onPress={handleWithdraw}
        disabled={!secretKey || isProcessing}
      >
        <Text style={styles.buttonText}>
          {isProcessing ? 'Processing...' : 'Submit Withdraw'}
        </Text>
      </TouchableOpacity>

      {state.message ? <Text style={styles.status}>Status: {state.message}</Text> : null}
      {lastResult ? <Text style={styles.result}>{lastResult}</Text> : null}
    </ScrollView>
  )
}

export default function App() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <SorobanResurrectProvider
        config={{ rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE }}
      >
        <WithdrawScreen />
      </SorobanResurrectProvider>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  label: { fontSize: 14, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 10,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#007bff',
    borderRadius: 6,
    padding: 12,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#ccc' },
  buttonText: { color: '#fff', fontWeight: '600' },
  status: { marginTop: 16 },
  result: { marginTop: 16, fontFamily: 'monospace' },
})
