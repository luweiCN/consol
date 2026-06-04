import { runCastReceipt } from "@consol/foundry";
import type { AccountMeta, NetworkMeta } from "@consol/protocol";
import type { CliEnv } from "../main";
import { receiptSummaryFromValue, recordDeploy, type ReceiptSummary } from "./transaction-history";

export async function fetchReceiptSummary(input: {
  readonly env: CliEnv;
  readonly projectRoot: string;
  readonly rpcUrl: string;
  readonly txHash: string;
}): Promise<ReceiptSummary | null> {
  const receipt = await runCastReceipt({
    cwd: input.projectRoot,
    env: input.env,
    rpcUrl: input.rpcUrl,
    txHash: input.txHash,
  });
  if (!receipt.ok) {
    return null;
  }

  try {
    return receiptSummaryFromValue(JSON.parse(receipt.stdout) as unknown);
  } catch {
    return null;
  }
}

export function recordDeployHistory(input: {
  readonly projectRoot: string;
  readonly contract: string;
  readonly target: string;
  readonly address: string;
  readonly txHash: string;
  readonly receipt: ReceiptSummary | null;
  readonly network: NetworkMeta;
  readonly account: AccountMeta;
  readonly signerAddress: string | null;
  readonly nonce: string | null;
  readonly gasPrice: string | null;
}): { readonly historyPath: string | null; readonly historyError: string | null } {
  try {
    return {
      historyPath: recordDeploy({
        projectRoot: input.projectRoot,
        contract: input.contract,
        target: input.target,
        address: input.address,
        txHash: input.txHash,
        receipt: input.receipt,
        network: input.network,
        account: input.account,
        signerAddress: input.signerAddress,
        nonce: input.nonce,
        gasPrice: input.gasPrice,
      }),
      historyError: null,
    };
  } catch (error) {
    return {
      historyPath: null,
      historyError: error instanceof Error ? error.message : String(error),
    };
  }
}
