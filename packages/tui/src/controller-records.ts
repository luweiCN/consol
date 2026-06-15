import type { DevFunctionInputDraft, DevSession, DevState } from "@consol/core";
import type { TxPreviewEvent } from "@consol/protocol";
import { argsFromDraftWithAbiDefaults } from "./abi-default-values";
import type {
  ConfirmedTxPreviewResult,
  DevContractEventRecord,
  DevDeployedContract,
  DevTransactionRecord,
} from "./runtime-types";

export function sameActiveDeployedContract(left: DevDeployedContract | null, right: DevDeployedContract | null): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null) {
    return false;
  }
  return left.id === right.id && left.address.toLowerCase() === right.address.toLowerCase();
}

export function mergeTransactionRecords(
  sessionRecords: readonly DevTransactionRecord[],
  cachedRecords: readonly DevTransactionRecord[],
): readonly DevTransactionRecord[] {
  const records = new Map<string, DevTransactionRecord>();
  for (const record of cachedRecords) {
    records.set(transactionMergeKey(record), record);
  }
  for (const record of sessionRecords) {
    records.set(transactionMergeKey(record), record);
  }

  return [...records.values()].sort((left, right) => right.createdAtUnix - left.createdAtUnix);
}

export function mergeDeployedContracts(
  current: readonly DevDeployedContract[],
  incoming: readonly DevDeployedContract[],
): readonly DevDeployedContract[] {
  const records = new Map<string, DevDeployedContract>();
  for (const contract of current) {
    records.set(deployedContractKey(contract), contract);
  }
  for (const contract of incoming) {
    records.set(deployedContractKey(contract), contract);
  }
  return [...records.values()].sort((left, right) => right.createdAtUnix - left.createdAtUnix);
}

function deployedContractKey(contract: DevDeployedContract): string {
  return `${deployedNetworkKey(contract)}:${contract.address.toLowerCase()}:${contract.contract}`;
}

function deployedNetworkKey(contract: DevDeployedContract): string {
  return contract.networkFingerprint ?? contract.network ?? (contract.chainId === null ? "-" : `chain:${contract.chainId}`);
}

export function mergeEventRecords(
  current: readonly DevContractEventRecord[],
  incoming: readonly DevContractEventRecord[],
): readonly DevContractEventRecord[] {
  const records = new Map<string, DevContractEventRecord>();
  for (const event of current) {
    records.set(eventRecordKey(event), event);
  }
  for (const event of incoming) {
    records.set(eventRecordKey(event), event);
  }
  return [...records.values()].sort((left, right) => right.createdAtUnix - left.createdAtUnix);
}

function eventRecordKey(event: DevContractEventRecord): string {
  return event.id || `${event.txHash ?? "-"}:${event.logIndex ?? "-"}:${event.event ?? "-"}:${event.address ?? "-"}`;
}

function transactionMergeKey(record: DevTransactionRecord): string {
  return record.txHash ?? record.previewId ?? record.id;
}

export function sameTransactionLifecycle(left: DevTransactionRecord, right: DevTransactionRecord): boolean {
  if (left.id === right.id) {
    return true;
  }
  if (left.previewId !== undefined && left.previewId !== null && left.previewId === right.previewId) {
    return true;
  }
  if (left.txHash !== null && right.txHash !== null && left.txHash === right.txHash) {
    return true;
  }
  return false;
}

export function transactionFromPreview(
  event: TxPreviewEvent,
  result: ConfirmedTxPreviewResult & { readonly transactionStatus?: string },
): DevTransactionRecord {
  const base: DevTransactionRecord = {
    id: `session:${event.id}`,
    previewId: event.id,
    action: event.action,
    contract: event.target.contract,
    target: event.target.display,
    functionName: event.calldata.function,
    signature: event.calldata.signature ?? event.calldata.function,
    args: event.calldata.args,
    result: result.message,
    rawOutput: result.message,
    txHash: result.txHash ?? txHashFromText(result.message),
    blockNumber: null,
    status: result.transactionStatus ?? (result.status === "ok" ? "ok" : "error"),
    gasUsed: null,
    network: event.network.name,
    chainId: String(event.network.chainId),
    networkFingerprint: event.network.fingerprint,
    account: event.account.name ?? shortAddress(event.account.address),
    from: event.account.address,
    signerAddress: event.signer.address ?? null,
    gasEstimate: event.gas.estimate === undefined ? null : String(event.gas.estimate),
    gasLimit: gasLimitFromPreview(event),
    gasEstimateError: event.gas.context?.["error"] === undefined ? null : String(event.gas.context["error"]),
    calldataPrefix: event.calldata.hex.length <= 42 ? event.calldata.hex : `${event.calldata.hex.slice(0, 42)}...`,
    value: event.value ?? null,
    createdAtUnix: eventCreatedAtUnix(event.timestamp),
  };
  return result.transaction === undefined ? base : { ...base, ...result.transaction };
}

export function deployedContractFromResult(
  session: DevSession,
  event: TxPreviewEvent,
  result: ConfirmedTxPreviewResult,
): DevDeployedContract | null {
  const tx = result.transaction;
  const address = tx?.contractAddress ?? tx?.address;
  if (address === null || address === undefined || address.length === 0) {
    return null;
  }

  return {
    id: `${event.network.fingerprint}:${event.target.contract}:${address.toLowerCase()}:${event.id}`,
    contract: event.target.contract,
    address,
    target: event.target.display,
    ...(session.workspaceRoot === undefined ? {} : { workspaceRoot: session.workspaceRoot }),
    sourceFile: event.target.sourceFile ?? session.sourceFile,
    network: tx?.network ?? event.network.name,
    chainId: tx?.chainId ?? String(event.network.chainId),
    networkFingerprint: tx?.networkFingerprint ?? event.network.fingerprint,
    account: tx?.account ?? event.account.name ?? null,
    deployTxHash: tx?.txHash ?? result.txHash ?? null,
    status: result.status === "ok" ? "ready" : "failed",
    constructorArgs: event.calldata.args,
    value: tx?.value ?? event.value ?? null,
    abiSummary: session.abiSummary,
    constructor: session.constructor,
    functions: session.functions,
    createdAtUnix: tx?.createdAtUnix ?? eventCreatedAtUnix(event.timestamp),
  };
}

export function transactionFromDraft(
  session: DevSession,
  draft: DevFunctionInputDraft,
  result: ConfirmedTxPreviewResult,
): DevTransactionRecord {
  return transactionFromFunctionResult({
    session,
    action: draft.action,
    functionName: draft.function.name,
    signature: draft.function.signature,
    args: argsFromDraftWithAbiDefaults(draft),
    result,
    ...(draft.accountName === undefined ? {} : { accountName: draft.accountName }),
    ...(draft.networkName === undefined ? {} : { networkName: draft.networkName }),
    ...(draft.targetOverride === undefined ? {} : { targetOverride: draft.targetOverride }),
    ...(draft.contractOverride === undefined ? {} : { contractOverride: draft.contractOverride }),
    ...(draft.addressOverride === undefined ? {} : { addressOverride: draft.addressOverride }),
  });
}

export function transactionFromSubmitted(
  session: DevSession,
  submitted: NonNullable<DevState["submittedFunction"]>,
  result: ConfirmedTxPreviewResult,
): DevTransactionRecord {
  return transactionFromFunctionResult({
    session,
    action: submitted.action,
    functionName: submitted.function.name,
    signature: submitted.function.signature,
    args: [],
    result,
    ...(submitted.accountName === undefined ? {} : { accountName: submitted.accountName }),
    ...(submitted.networkName === undefined ? {} : { networkName: submitted.networkName }),
    ...(submitted.targetOverride === undefined ? {} : { targetOverride: submitted.targetOverride }),
    ...(submitted.contractOverride === undefined ? {} : { contractOverride: submitted.contractOverride }),
    ...(submitted.addressOverride === undefined ? {} : { addressOverride: submitted.addressOverride }),
  });
}

function transactionFromFunctionResult(input: {
  readonly session: DevSession;
  readonly action: DevFunctionInputDraft["action"];
  readonly functionName: string;
  readonly signature: string;
  readonly args: readonly string[];
  readonly result: ConfirmedTxPreviewResult;
  readonly accountName?: string;
  readonly networkName?: string;
  readonly targetOverride?: string;
  readonly contractOverride?: string;
  readonly addressOverride?: string;
}): DevTransactionRecord {
  const createdAtUnix = Math.floor(Date.now() / 1000);
  const target = input.targetOverride ?? input.session.target;
  const contract = input.contractOverride ?? input.session.contract;
  return {
    id: `session:${createdAtUnix}:${input.action}:${target}:${input.signature}:${input.args.join("\u0000")}`,
    action: input.action,
    contract,
    target,
    functionName: input.functionName,
    signature: input.signature,
    args: input.args,
    result: input.result.message,
    rawOutput: input.result.message,
    txHash: txHashFromText(input.result.message),
    blockNumber: null,
    status: input.result.status === "ok" ? "ok" : "error",
    gasUsed: null,
    network: input.networkName ?? null,
    account: input.accountName ?? null,
    address: input.addressOverride ?? null,
    to: input.addressOverride ?? null,
    createdAtUnix,
  };
}

function gasLimitFromPreview(event: TxPreviewEvent): string | null {
  const value = event.gas.context?.["gasLimit"];
  return value === undefined || value === null || value === "" ? null : String(value);
}

function txHashFromText(value: string): string | null {
  const match = value.match(/0x[a-fA-F0-9]{64}/);
  return match?.[0] ?? null;
}

function eventCreatedAtUnix(timestamp: string): number {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? Math.floor(Date.now() / 1000) : Math.floor(date.getTime() / 1000);
}

function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}...${address.slice(-4)}`;
}
