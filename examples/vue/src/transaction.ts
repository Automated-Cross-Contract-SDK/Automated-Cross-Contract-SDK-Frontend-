import { Operation, TransactionBuilder, nativeToScVal } from '@stellar/stellar-sdk'
import type { Transaction } from '@stellar/stellar-sdk'
import type { ISorobanRpcClient } from '@soroban-resurrect/sdk'
import { CONTRACT_ID } from './config.js'

/**
 * Builds the sample contract call the demo submits: `withdraw(1000)` against
 * {@link CONTRACT_ID}.
 *
 * The source account is fetched through the SDK's own RPC client
 * (`resurrect.server`), so whichever instance is driving the flow — the
 * composable's or the plugin's — the transaction is built against the right
 * network.
 */
export async function buildSampleTransaction(
  server: ISorobanRpcClient,
  networkPassphrase: string,
  publicKey: string,
): Promise<Transaction> {
  const account = await server.getAccount(publicKey)

  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase,
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
}
