import {
  Contract,
  Keypair,
  Networks,
  SorobanRpc,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import type { WalletAdapter } from './wallet-adapter';

/**
 * Options controlling the restore flow used by
 * {@link SorobanResurrect.restoreKeys} and the restore phase of
 * {@link SorobanResurrect.submitWithRestore}.
 */
export interface RestoreKeysOptions {
  /** Called before the restore transaction is signed. */
  onSigningRestore?: (restoreTx: Transaction) => void | Promise<void>;
  /** Called before the restore transaction is submitted. */
  onSubmittingRestore?: (restoreTx: Transaction) => void | Promise<void>;
  /** Called after the restore transaction has been submitted, with its hash. */
  onRestoreSubmitted?: (hash: string) => void | Promise<void>;
  /** Called after the restore transaction has been confirmed. */
  onRestoreConfirmed?: (hash: string) => void | Promise<void>;
}

export interface SorobanResurrectOptions {
  rpcUrl: string;
  networkPassphrase?: string;
  /**
   * Maximum fee (in stroops) allowed for a restore transaction. When the
   * estimated fee exceeds this cap, the restore is aborted.
   */
  maxRestoreFee?: number;
}

export interface SubmitWithRestoreOptions extends RestoreKeysOptions {
  /** Optional timeout (ms) to wait for the restore transaction to confirm. */
  restoreTimeoutMs?: number;
}

export class SorobanResurrect {
  private readonly server: SorobanRpc.Server;
  private readonly networkPassphrase: string;
  private readonly maxRestoreFee?: number;

  constructor(options: SorobanResurrectOptions) {
    this.server = new SorobanRpc.Server(options.rpcUrl);
    this.networkPassphrase = options.networkPassphrase ?? Networks.FUTURENET;
    this.maxRestoreFee = options.maxRestoreFee;
  }

  /**
   * Restore the given ledger keys, invoking the documented
   * {@link RestoreKeysOptions} callbacks at each step of the flow.
   */
  async restoreKeys(
    keys: xdr.LedgerKey[],
    wallet: WalletAdapter,
    options?: RestoreKeysOptions,
  ): Promise<string> {
    const source = await wallet.getPublicKey();
    const account = await this.server.getAccount(source);

    const restoreTx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .setTimeout(30)
      .addOperation(
        Contract.call('__restore', ...keys.map((key) => xdr.LedgerKey.toXDR(key))),
      )
      .build();

    const prepared = await this.server.prepareTransaction(restoreTx);

    if (this.maxRestoreFee !== undefined) {
      const fee = BigInt(prepared.fee);
      if (fee > BigInt(this.maxRestoreFee)) {
        throw new Error(
          `Restore fee ${fee.toString()} exceeds cap ${this.maxRestoreFee}`,
        );
      }
    }

    await options?.onSigningRestore?.(prepared);

    const signed = await wallet.signTransaction(prepared);

    await options?.onSubmittingRestore?.(signed);

    const response = await this.server.sendTransaction(signed);
    const hash = response.hash;

    await options?.onRestoreSubmitted?.(hash);

    await this.waitForConfirmation(hash);

    await options?.onRestoreConfirmed?.(hash);

    return hash;
  }

  /**
   * Submit a transaction, restoring any expired ledger keys first. The restore
   * phase invokes the {@link RestoreKeysOptions} callbacks in the same order as
   * {@link restoreKeys}.
   */
  async submitWithRestore(
    tx: Transaction,
    wallet: WalletAdapter,
    options?: SubmitWithRestoreOptions,
  ): Promise<string> {
    const expired = await this.findExpiredKeys(tx);

    if (expired.length > 0) {
      await this.restoreKeys(expired, wallet, options);
    }

    const signed = await wallet.signTransaction(tx);
    const response = await this.server.sendTransaction(signed);

    await this.waitForConfirmation(response.hash, options?.restoreTimeoutMs);

    return response.hash;
  }

  private async findExpiredKeys(tx: Transaction): Promise<xdr.LedgerKey[]> {
    const footprint = tx.toEnvelope().v1()?.tx()?.ext()?.sorobanData()?.resources()?.footprint();
    if (!footprint) {
      return [];
    }

    const keys = [...footprint.readOnly(), ...footprint.readWrite()];
    const expired: xdr.LedgerKey[] = [];

    for (const key of keys) {
      const entry = await this.server.getLedgerEntries(key);
      if (entry.entries.length === 0) {
        expired.push(key);
      }
    }

    return expired;
  }

  private async waitForConfirmation(hash: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const response = await this.server.getTransaction(hash);
      if (response.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        return;
      }
      if (response.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`Transaction ${hash} failed`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new Error(`Timed out waiting for transaction ${hash}`);
  }
}
