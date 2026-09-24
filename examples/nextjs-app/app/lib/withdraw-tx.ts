import {
  Operation,
  TransactionBuilder,
  nativeToScVal,
  type Transaction,
} from '@stellar/stellar-sdk'
import type { ISorobanRpcClient } from '@soroban-resurrect/sdk'
import { WITHDRAW_AMOUNT } from './client-config'

/**
 * Builds the unsigned `withdraw` transaction this example submits.
 *
 * Kept free of any browser or Node specifics so the exact same builder runs
 * in the Server Component (to detect archived entries) and in the Client
 * Component (to submit with automatic restoration).
 *
 * @param server           - RPC client used to fetch the source account sequence.
 * @param sourcePublicKey  - Public key that will sign and pay for the transaction.
 * @param networkPassphrase - Network passphrase to build against.
 * @param contractId       - Contract the `withdraw` function is invoked on.
 */
export async function buildWithdrawTransaction(
  server: Pick<ISorobanRpcClient, 'getAccount'>,
  sourcePublicKey: string,
  networkPassphrase: string,
  contractId: string,
): Promise<Transaction> {
  const account = await server.getAccount(sourcePublicKey)

  return new TransactionBuilder(account, { fee: '100', networkPassphrase })
    .addOperation(
      Operation.invokeContractFunction({
        contract: contractId,
        function: 'withdraw',
        args: [nativeToScVal(WITHDRAW_AMOUNT, { type: 'i128' })],
      }),
    )
    .setTimeout(30)
    .build()
}
