import { activeAccountMeta, activeNetworkRuntime, type ResolvedTarget } from "@consol/core";
import { runCastCall } from "@consol/foundry";
import type { AccountMeta, NetworkMeta, TxPreviewEvent } from "@consol/protocol";
import type { ConfirmedTxPreviewResult, DevContractEventRecord, DevTransactionRecord, FunctionInputSubmission } from "@consol/tui";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { createReadContext } from "./interact-context";
import { runSendCommand } from "./send";
import { runDeployCommand } from "./deploy";
import { ensureDevArtifact } from "./dev-artifact";
import { rpcAdapterForNetwork } from "./dev-runtime";
import { gasLimitArgs, sessionActionGlobals } from "./dev-submission-context";
import { devContractEventArgFromUnknown, logLinesFromUnknown } from "./dev-records";
import {
  arrayFromUnknown,
  errorMessage,
  eventCreatedAtUnix,
  nullableScalarStringFromUnknown,
  nullableStringFromUnknown,
  numberFromUnknown,
  rawEventString,
  recordFromUnknown,
  stringFromUnknown,
} from "./dev-unknown";
import { createFunctionInputPreview, isTxPreviewEvent, type DevActionContext, type DevTxInput } from "./dev-tx-preview";

export async function executeConfirmedTxPreview(
  input: DevTxInput,
  event: TxPreviewEvent,
  previewActionContexts: Map<string, DevActionContext>,
  previewFollowups: Map<string, FunctionInputSubmission>,
): Promise<ConfirmedTxPreviewResult> {
  const actionContext = previewActionContexts.get(event.id);
  const followup = previewFollowups.get(event.id);
  previewFollowups.delete(event.id);
  const commandInput = {
    globals: actionContext?.globals ?? (actionContext === undefined ? input.globals : sessionActionGlobals(input.globals)),
    cwd: actionContext?.cwd ?? input.cwd,
    env: input.env,
  };
  if (event.action === "read") {
    const target = actionContext?.target ?? event.target.display;
    return await executeReadPreview(
      {
        ...commandInput,
        ensureArtifact: async (resolved) => {
          await ensureDevArtifact(input, { target, resolved });
        },
      },
      event,
      target,
      actionContext?.address,
    );
  }

  if (event.action === "send") {
    const target = actionContext?.target ?? event.target.display;
    return await confirmedResult(
      input,
      event,
      await runSendCommand({
        ...commandInput,
        globals: { ...commandInput.globals, json: true },
        ensureArtifact: async (resolved) => {
          await ensureDevArtifact(input, { target, resolved });
        },
        commandArgs: [
          target,
          event.calldata.signature ?? event.calldata.function,
          ...event.calldata.args,
          ...(actionContext?.address === undefined ? [] : ["--address", actionContext.address]),
          ...(event.value === undefined || event.value === null ? [] : ["--value", event.value]),
          ...gasLimitArgs(event),
        ],
      }),
    );
  }

  let deployCommandResult: CliResult;
  try {
    deployCommandResult = await runDeployCommand({
      ...commandInput,
      globals: { ...commandInput.globals, json: true },
      commandArgs: [
        actionContext?.target ?? event.target.display,
        ...(actionContext !== undefined ? ["--fresh"] : []),
        ...(event.value === undefined || event.value === null ? [] : ["--value", event.value]),
        ...gasLimitArgs(event),
        ...event.calldata.args,
      ],
    });
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }

  const deployResult = await confirmedResult(input, event, deployCommandResult);
  if (deployResult.status !== "ok" || followup === undefined) {
    return deployResult;
  }

  const next = await createFunctionInputPreview(input, followup, previewActionContexts, previewFollowups);
  if (isTxPreviewEvent(next)) {
    return { ...deployResult, nextPreview: next };
  }

  return {
    status: next.status,
    message: `${deployResult.message}\n${next.message}`,
    ...(next.nextPreview === undefined ? {} : { nextPreview: next.nextPreview }),
  };
}

async function executeReadPreview(
  input: {
    readonly globals: GlobalArgs;
    readonly cwd: string;
    readonly env: CliEnv;
    readonly ensureArtifact?: (resolved: ResolvedTarget) => Promise<void>;
  },
  event: TxPreviewEvent,
  target: string,
  addressOverride?: string,
): Promise<ConfirmedTxPreviewResult> {
  const context = await createReadContext({
    globals: input.globals,
    cwd: input.cwd,
    env: input.env,
    target,
    ...(addressOverride === undefined ? {} : { addressOverride }),
    ...(input.ensureArtifact === undefined ? {} : { ensureArtifact: input.ensureArtifact }),
  });
  const signature = event.calldata.signature ?? event.calldata.function;
  const address = addressOverride ?? context.address;
  const call = await runCastCall({
    cwd: context.resolved.projectRoot,
    env: input.env,
    rpcUrl: context.rpc_url,
    address,
    signature,
    args: event.calldata.args,
  });

  return {
    status: call.ok ? "ok" : "error",
    message: call.ok
      ? `${context.resolved.contractName} ${signature} -> ${call.stdout.trim()}`
      : `cast call failed for ${signature}.`,
  };
}

async function confirmedResult(
  input: DevTxInput,
  event: TxPreviewEvent,
  result: CliResult,
): Promise<ConfirmedTxPreviewResult> {
  const parsed = parseSuccessEnvelope(result.stdout);
  const data = recordFromUnknown(parsed?.["data"]);
  const meta = recordFromUnknown(parsed?.["meta"]);
  const txHash = nullableStringFromUnknown(data?.["tx_hash"]);
  const base: ConfirmedTxPreviewResult = {
    status: result.exitCode === 0 ? "ok" : "error",
    message: confirmedResultMessage(event, result, data),
    ...(txHash === null || (input.createRpcAdapter === undefined && !isFullTransactionHash(txHash)) ? {} : { txHash }),
  };
  if (base.status !== "ok") {
    return base;
  }

  return await enrichConfirmedResult(input, event, base, data, meta, result.stdout);
}

function parseSuccessEnvelope(stdout: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const envelope = recordFromUnknown(parsed);
    return envelope?.["ok"] === true ? envelope : undefined;
  } catch {
    return undefined;
  }
}

function confirmedResultMessage(event: TxPreviewEvent, result: CliResult, data: Record<string, unknown> | undefined): string {
  if (data !== undefined && event.action === "send") {
    const contract = stringFromUnknown(data["contract"]) ?? event.target.contract;
    const signature = stringFromUnknown(data["signature"]) ?? event.calldata.signature ?? event.calldata.function;
    const txHash = nullableStringFromUnknown(data["tx_hash"]);
    return `${contract} ${signature} -> ${txHash ?? "submitted"}`;
  }

  if (data !== undefined && event.action === "deploy") {
    const contract = stringFromUnknown(data["contract"]) ?? event.target.contract;
    const address = stringFromUnknown(data["address"]) ?? "submitted";
    const cached = data["cached"] === true ? " (cached)" : "";
    return `${contract} deployed at ${address}${cached}`;
  }

  return result.stdout.trim() || result.stderr.trim() || `exit ${result.exitCode}`;
}

async function enrichConfirmedResult(
  input: DevTxInput,
  event: TxPreviewEvent,
  result: ConfirmedTxPreviewResult,
  data: Record<string, unknown> | undefined,
  meta: Record<string, unknown> | undefined,
  rawOutput: string,
): Promise<ConfirmedTxPreviewResult> {
  const txHash = result.txHash ?? txHashFromText(result.message);
  if (txHash === null || txHash === undefined) {
    return result;
  }
  if (input.createRpcAdapter === undefined && !isFullTransactionHash(txHash)) {
    return { ...result, txHash };
  }

  const network = networkMetaFromUnknown(meta?.["network"]) ?? activeNetworkRuntime(input.env).meta;
  const account = accountMetaFromUnknown(meta?.["account"]) ?? activeAccountMeta(input.env);
  const adapter = rpcAdapterForNetwork(input, network);
  try {
    const receipt = await adapter.waitForTransactionReceipt(txHash);
    const transaction = await adapter.getTransaction(txHash).catch(() => undefined);
    const receiptRecord = recordFromUnknown(receipt);
    const minedBlockNumber = bigintFromUnknown(receiptRecord?.["blockNumber"] ?? receiptRecord?.["block_number"]);
    const minedBlock = minedBlockNumber === null ? undefined : await adapter.getBlock({ blockNumber: minedBlockNumber }).catch(() => undefined);
    const latestBlock = await adapter.getBlock({ blockTag: "latest" }).catch(() => undefined);
    return {
      ...result,
      txHash,
      transaction: rpcTransactionRecord({
        event,
        result,
        txHash,
        data,
        receipt,
        transaction,
        minedBlock,
        latestBlock,
        network,
        account,
        rawOutput,
      }),
    };
  } catch {
    return { ...result, txHash };
  }
}

function rpcTransactionRecord(input: {
  readonly event: TxPreviewEvent;
  readonly result: ConfirmedTxPreviewResult;
  readonly txHash: string;
  readonly data: Record<string, unknown> | undefined;
  readonly receipt: unknown;
  readonly transaction: unknown;
  readonly minedBlock: unknown;
  readonly latestBlock: unknown;
  readonly network: NetworkMeta;
  readonly account: AccountMeta;
  readonly rawOutput: string;
}): DevTransactionRecord {
  const receipt = recordFromUnknown(input.receipt);
  const transaction = recordFromUnknown(input.transaction);
  const minedBlock = recordFromUnknown(input.minedBlock);
  const latestBlock = recordFromUnknown(input.latestBlock);
  const receiptBlockNumber = bigintFromUnknown(receipt?.["blockNumber"] ?? receipt?.["block_number"]);
  const latestBlockNumber = bigintFromUnknown(latestBlock?.["number"] ?? latestBlock?.["blockNumber"]);
  return {
    id: input.txHash,
    action: input.event.action,
    contract: input.event.target.contract,
    target: input.event.target.display,
    functionName: input.event.calldata.function,
    signature: input.event.calldata.signature ?? input.event.calldata.function,
    args: input.event.calldata.args,
    result: input.result.message,
    rawOutput: input.rawOutput,
    txHash: input.txHash,
    blockNumber: receiptBlockNumber === null ? null : String(receiptBlockNumber),
    confirmations: confirmationCount(receiptBlockNumber, latestBlockNumber),
    status: receiptStatus(receipt?.["status"]),
    gasUsed: nullableScalarStringFromUnknown(receipt?.["gasUsed"] ?? receipt?.["gas_used"]),
    gasLimit: nullableScalarStringFromUnknown(transaction?.["gas"] ?? transaction?.["gasLimit"] ?? transaction?.["gas_limit"]),
    network: input.network.name,
    chainId: input.network.chain_id === null ? null : String(input.network.chain_id),
    networkFingerprint: input.network.fingerprint,
    account: input.account.name,
    address: nullableStringFromUnknown(input.data?.["address"]),
    from: nullableStringFromUnknown(transaction?.["from"]) ?? input.account.address,
    to: nullableStringFromUnknown(transaction?.["to"]) ?? nullableStringFromUnknown(input.data?.["address"]),
    signerAddress: nullableStringFromUnknown(input.data?.["signer_address"]) ?? input.account.address,
    nonce: nullableScalarStringFromUnknown(transaction?.["nonce"]) ?? nullableScalarStringFromUnknown(input.data?.["nonce"]),
    gasPrice: nullableScalarStringFromUnknown(transaction?.["gasPrice"] ?? transaction?.["gas_price"]) ?? nullableScalarStringFromUnknown(input.data?.["gas_price"]),
    maxFeePerGas: nullableScalarStringFromUnknown(transaction?.["maxFeePerGas"] ?? transaction?.["max_fee_per_gas"]),
    maxPriorityFeePerGas: nullableScalarStringFromUnknown(transaction?.["maxPriorityFeePerGas"] ?? transaction?.["max_priority_fee_per_gas"]),
    effectiveGasPrice: nullableScalarStringFromUnknown(receipt?.["effectiveGasPrice"] ?? receipt?.["effective_gas_price"]),
    contractAddress: nullableStringFromUnknown(receipt?.["contractAddress"] ?? receipt?.["contract_address"]),
    gasEstimate: nullableScalarStringFromUnknown(input.data?.["gas_estimate"]) ?? (input.event.gas.estimate === undefined ? null : String(input.event.gas.estimate)),
    gasEstimateError: nullableScalarStringFromUnknown(input.data?.["gas_estimate_error"]),
    calldataHash: nullableStringFromUnknown(input.data?.["calldata_hash"]),
    calldataPrefix: nullableStringFromUnknown(input.data?.["calldata_prefix"]) ?? (input.event.calldata.hex.length <= 42 ? input.event.calldata.hex : `${input.event.calldata.hex.slice(0, 42)}...`),
    input: nullableStringFromUnknown(transaction?.["input"]),
    logs: logLinesFromUnknown(receipt?.["logs"]),
    events: eventRecordsFromReceiptLogs({
      logs: receipt?.["logs"],
      event: input.event,
      createdAtUnix: eventCreatedAtUnix(input.event.timestamp),
    }),
    value: nullableScalarStringFromUnknown(transaction?.["value"]) ?? input.event.value ?? null,
    blockTimestamp: nullableScalarStringFromUnknown(minedBlock?.["timestamp"]),
    createdAtUnix: eventCreatedAtUnix(input.event.timestamp),
  };
}

function eventRecordsFromReceiptLogs(input: {
  readonly logs: unknown;
  readonly event: TxPreviewEvent;
  readonly createdAtUnix: number;
}): readonly DevContractEventRecord[] {
  return arrayFromUnknown(input.logs).map((log, index) => {
    const record = recordFromUnknown(log);
    const txHash = nullableStringFromUnknown(record?.["transactionHash"] ?? record?.["transaction_hash"]);
    const logIndex = nullableScalarStringFromUnknown(record?.["logIndex"] ?? record?.["log_index"]) ?? String(index);
    return {
      id: `${txHash ?? input.event.id}:${logIndex}`,
      source: "receipt",
      contract: input.event.target.contract,
      address: nullableStringFromUnknown(record?.["address"]) ?? nullableStringFromUnknown(record?.["to"]),
      event: nullableStringFromUnknown(record?.["event"]) ?? nullableStringFromUnknown(record?.["name"]),
      signature: nullableStringFromUnknown(record?.["signature"]),
      args: arrayFromUnknown(record?.["args"]).map(devContractEventArgFromUnknown),
      raw: rawEventString(log),
      txHash,
      blockNumber: nullableScalarStringFromUnknown(record?.["blockNumber"] ?? record?.["block_number"]),
      logIndex,
      createdAtUnix: input.createdAtUnix,
    };
  });
}

function networkMetaFromUnknown(raw: unknown): NetworkMeta | null {
  const record = recordFromUnknown(raw);
  const name = stringFromUnknown(record?.["name"]);
  const kind = stringFromUnknown(record?.["kind"]);
  const rpcUrl = stringFromUnknown(record?.["rpc_url"]);
  const writePolicy = stringFromUnknown(record?.["write_policy"]);
  if (name === undefined || kind === undefined || rpcUrl === undefined || writePolicy === undefined) {
    return null;
  }

  return {
    name,
    kind,
    chain_id: numberFromUnknown(record?.["chain_id"]) ?? null,
    rpc_url: rpcUrl,
    fork_url: nullableStringFromUnknown(record?.["fork_url"]),
    fork_block_number: numberFromUnknown(record?.["fork_block_number"]) ?? null,
    fingerprint: nullableStringFromUnknown(record?.["fingerprint"]),
    write_policy: writePolicy,
  };
}

function accountMetaFromUnknown(raw: unknown): AccountMeta | null {
  const record = recordFromUnknown(raw);
  const name = stringFromUnknown(record?.["name"]);
  const signer = stringFromUnknown(record?.["signer"]);
  if (name === undefined || signer === undefined) {
    return null;
  }

  return {
    name,
    address: nullableStringFromUnknown(record?.["address"]),
    signer,
  };
}

function receiptStatus(raw: unknown): string | null {
  if (raw === "success" || raw === "0x1" || raw === 1 || raw === 1n || raw === true) {
    return "success";
  }
  if (raw === "reverted" || raw === "0x0" || raw === 0 || raw === 0n || raw === false) {
    return "reverted";
  }
  return nullableScalarStringFromUnknown(raw);
}

function confirmationCount(receiptBlockNumber: bigint | null, latestBlockNumber: bigint | null): string | null {
  if (receiptBlockNumber === null || latestBlockNumber === null || latestBlockNumber < receiptBlockNumber) {
    return null;
  }

  return String(latestBlockNumber - receiptBlockNumber + 1n);
}

function bigintFromUnknown(raw: unknown): bigint | null {
  if (typeof raw === "bigint") {
    return raw;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return BigInt(Math.trunc(raw));
  }
  if (typeof raw !== "string") {
    return null;
  }

  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

function isFullTransactionHash(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function txHashFromText(value: string): string | null {
  const match = value.match(/0x[a-fA-F0-9]{64}/);
  return match?.[0] ?? null;
}
