import { stableHash } from "@consol/core";
import type { AccountMeta, NetworkMeta } from "@consol/protocol";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ReceiptSummary = {
  readonly status: string | null;
  readonly block_number: string | null;
  readonly gas_used: string | null;
  readonly effective_gas_price: string | null;
  readonly contract_address: string | null;
};

export type RecordSendInput = {
  readonly projectRoot: string;
  readonly contract: string;
  readonly target: string | null;
  readonly address: string;
  readonly functionName: string;
  readonly signature: string;
  readonly args: readonly string[];
  readonly value: string | null;
  readonly gasEstimate: string | null;
  readonly gasEstimateError: string | null;
  readonly txHash: string | null;
  readonly receipt: ReceiptSummary | null;
  readonly network: NetworkMeta;
  readonly account: AccountMeta;
  readonly signerAddress: string | null;
  readonly nonce: string | null;
  readonly gasPrice: string | null;
  readonly calldataHash: string | null;
  readonly calldataPrefix: string | null;
};

export type RecordDeployInput = {
  readonly projectRoot: string;
  readonly contract: string;
  readonly target: string | null;
  readonly address: string;
  readonly txHash: string | null;
  readonly receipt: ReceiptSummary | null;
  readonly network: NetworkMeta;
  readonly account: AccountMeta;
  readonly signerAddress: string | null;
  readonly nonce: string | null;
  readonly gasPrice: string | null;
};

export function recordDeploy(input: RecordDeployInput): string {
  const path = txHistoryPath(input.projectRoot);
  const history = readHistory(path);
  const createdAtUnix = Math.floor(Date.now() / 1000);
  const record = {
    id: input.txHash ?? `${createdAtUnix}-${stableHash(`deploy:${input.contract}`)}`,
    action: "deploy",
    contract: input.contract,
    target: input.target,
    address: input.address,
    function: null,
    signature: null,
    args: [],
    value: null,
    gas_estimate: null,
    gas_estimate_error: null,
    tx_hash: input.txHash,
    receipt: input.receipt,
    network: input.network.name,
    chain_id: input.network.chain_id,
    network_fingerprint: input.network.fingerprint,
    account: input.account.name,
    from: input.account.address,
    signer_address: input.signerAddress,
    to: null,
    nonce: input.nonce,
    gas_price: input.gasPrice,
    calldata_hash: null,
    calldata_prefix: null,
    created_at_unix: createdAtUnix,
  };

  writeHistory(path, history.entries, record);
  return path;
}

export function recordSend(input: RecordSendInput): string {
  const path = txHistoryPath(input.projectRoot);
  const history = readHistory(path);
  const createdAtUnix = Math.floor(Date.now() / 1000);
  const record = {
    id: input.txHash ?? `${createdAtUnix}-${stableHash(`send:${input.contract}`)}`,
    action: "send",
    contract: input.contract,
    target: input.target,
    address: input.address,
    function: input.functionName,
    signature: input.signature,
    args: [...input.args],
    value: input.value,
    gas_estimate: input.gasEstimate,
    gas_estimate_error: input.gasEstimateError,
    tx_hash: input.txHash,
    receipt: input.receipt,
    network: input.network.name,
    chain_id: input.network.chain_id,
    network_fingerprint: input.network.fingerprint,
    account: input.account.name,
    from: input.account.address,
    signer_address: input.signerAddress,
    to: input.address,
    nonce: input.nonce,
    gas_price: input.gasPrice,
    calldata_hash: input.calldataHash,
    calldata_prefix: input.calldataPrefix,
    created_at_unix: createdAtUnix,
  };

  writeHistory(path, history.entries, record);
  return path;
}

export function txHistoryPath(projectRoot: string): string {
  return join(projectRoot, ".consol", "transactions.json");
}

export function receiptSummaryFromValue(value: unknown): ReceiptSummary {
  return {
    status: valueField(value, "status"),
    block_number: valueField(value, "blockNumber"),
    gas_used: valueField(value, "gasUsed"),
    effective_gas_price: valueField(value, "effectiveGasPrice"),
    contract_address: valueField(value, "contractAddress"),
  };
}

function readHistory(path: string): { readonly entries: readonly { readonly id: string }[] } {
  if (!existsSync(path)) {
    return { entries: [] };
  }

  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const entries = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>).entries : [];
  return {
    entries: Array.isArray(entries) ? entries.flatMap(historyEntry) : [],
  };
}

function writeHistory(path: string, entries: readonly { readonly id: string }[], record: { readonly id: string }): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        version: 1,
        entries: [...entries.filter((entry) => entry.id !== record.id), record],
      },
      null,
      2,
    ),
  );
}

function historyEntry(value: unknown): readonly { readonly id: string }[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }

  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" ? [value as { readonly id: string }] : [];
}

function valueField(value: unknown, field: string): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const fieldValue = (value as Record<string, unknown>)[field];
  switch (typeof fieldValue) {
    case "string":
      return fieldValue;
    case "number":
    case "bigint":
    case "boolean":
      return String(fieldValue);
    default:
      return null;
  }
}
