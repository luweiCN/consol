import type { DevSession } from "@consol/core";
import type { DevContractEventRecord, DevTransactionRecord } from "@consol/tui";
import type { GlobalArgs } from "../args";
import type { CliEnv } from "../main";
import { createDevJsonSnapshot } from "./dev-json";
import {
  arrayFromUnknown,
  nullableScalarStringFromUnknown,
  nullableStringFromUnknown,
  numberFromUnknown,
  rawEventString,
  recordFromUnknown,
  stringFromUnknown,
} from "./dev-unknown";

// Narrowed view of the dev command input — only the fields record assembly
// needs. `RunDevCommandInput` structurally satisfies this.
type DevRecordsInput = {
  readonly globals: GlobalArgs;
  readonly env: CliEnv;
};

export async function createDevTransactionsSnapshot(input: DevRecordsInput, session: DevSession): Promise<readonly DevTransactionRecord[]> {
  try {
    const snapshot = await createDevJsonSnapshot({
      globals: input.globals,
      cwd: session.projectRoot,
      env: input.env,
      session,
    });
    return arrayFromUnknown(snapshot.data["transactions"]).map(devTransactionRecordFromUnknown);
  } catch {
    return [];
  }
}

export async function createDevEventRecordsSnapshot(input: DevRecordsInput, session: DevSession): Promise<readonly DevContractEventRecord[]> {
  try {
    const snapshot = await createDevJsonSnapshot({
      globals: input.globals,
      cwd: session.projectRoot,
      env: input.env,
      session,
    });
    const logs = recordFromUnknown(snapshot.data["events"]);
    return arrayFromUnknown(logs?.["events"]).map((event, index) => devContractEventRecordFromUnknown(event, session, index));
  } catch {
    return [];
  }
}

function devContractEventRecordFromUnknown(raw: unknown, session: DevSession, index: number): DevContractEventRecord {
  const record = recordFromUnknown(raw);
  const txHash = nullableStringFromUnknown(record?.["transaction_hash"]);
  const blockNumber = nullableScalarStringFromUnknown(record?.["block_number"]);
  const logIndex = nullableScalarStringFromUnknown(record?.["log_index"]);
  return {
    id: `${txHash ?? "event"}:${logIndex ?? index}`,
    source: "logs",
    contract: session.contract,
    address: nullableStringFromUnknown(record?.["address"]),
    event: nullableStringFromUnknown(record?.["event"]),
    signature: nullableStringFromUnknown(record?.["signature"]),
    args: arrayFromUnknown(record?.["args"]).map(devContractEventArgFromUnknown),
    raw: rawEventString(record?.["raw"]),
    txHash,
    blockNumber,
    logIndex,
    createdAtUnix: Math.floor(Date.now() / 1000) - index,
  };
}

export function devContractEventArgFromUnknown(raw: unknown): DevContractEventRecord["args"][number] {
  const record = recordFromUnknown(raw);
  return {
    name: stringFromUnknown(record?.["name"]) ?? "",
    kind: stringFromUnknown(record?.["kind"]) ?? "",
    indexed: record?.["indexed"] === true,
    value: nullableScalarStringFromUnknown(record?.["value"]) ?? "",
  };
}

function devTransactionRecordFromUnknown(raw: unknown): DevTransactionRecord {
  const record = recordFromUnknown(raw);
  const receipt = recordFromUnknown(record?.["receipt"]);
  const transaction = recordFromUnknown(record?.["transaction"]);
  const block = recordFromUnknown(record?.["block"]);
  const id = stringFromUnknown(record?.["id"]) ?? `${numberFromUnknown(record?.["created_at_unix"]) ?? 0}:${stringFromUnknown(record?.["action"]) ?? "tx"}`;
  const rawOutput = devTransactionRawOutput(record);
  return {
    id,
    action: stringFromUnknown(record?.["action"]) ?? "tx",
    contract: stringFromUnknown(record?.["contract"]) ?? "",
    target: nullableStringFromUnknown(record?.["target"]),
    functionName: nullableStringFromUnknown(record?.["function"]),
    signature: nullableStringFromUnknown(record?.["signature"]),
    args: arrayFromUnknown(record?.["args"]).flatMap((item) => {
      const value = stringFromUnknown(item);
      return value === undefined ? [] : [value];
    }),
    result: nullableStringFromUnknown(record?.["result"]),
    rawOutput,
    txHash: nullableStringFromUnknown(record?.["tx_hash"]),
    blockNumber: nullableScalarStringFromUnknown(receipt?.["block_number"] ?? receipt?.["blockNumber"]),
    confirmations: nullableScalarStringFromUnknown(record?.["confirmations"] ?? receipt?.["confirmations"]),
    status: nullableScalarStringFromUnknown(receipt?.["status"]),
    gasUsed: nullableScalarStringFromUnknown(receipt?.["gas_used"] ?? receipt?.["gasUsed"]),
    gasLimit: nullableScalarStringFromUnknown(record?.["gas_limit"] ?? record?.["gasLimit"] ?? transaction?.["gas"] ?? transaction?.["gasLimit"]),
    network: nullableStringFromUnknown(record?.["network"]),
    chainId: nullableScalarStringFromUnknown(record?.["chain_id"]),
    networkFingerprint: nullableStringFromUnknown(record?.["network_fingerprint"]),
    account: nullableStringFromUnknown(record?.["account"]),
    address: nullableStringFromUnknown(record?.["address"]),
    from: nullableStringFromUnknown(record?.["from"]),
    to: nullableStringFromUnknown(record?.["to"]),
    signerAddress: nullableStringFromUnknown(record?.["signer_address"]),
    nonce: nullableScalarStringFromUnknown(record?.["nonce"]),
    gasPrice: nullableScalarStringFromUnknown(record?.["gas_price"] ?? record?.["gasPrice"] ?? transaction?.["gasPrice"]),
    maxFeePerGas: nullableScalarStringFromUnknown(record?.["max_fee_per_gas"] ?? record?.["maxFeePerGas"] ?? transaction?.["maxFeePerGas"]),
    maxPriorityFeePerGas: nullableScalarStringFromUnknown(
      record?.["max_priority_fee_per_gas"] ?? record?.["maxPriorityFeePerGas"] ?? transaction?.["maxPriorityFeePerGas"],
    ),
    effectiveGasPrice: nullableScalarStringFromUnknown(receipt?.["effective_gas_price"] ?? receipt?.["effectiveGasPrice"]),
    contractAddress: nullableStringFromUnknown(receipt?.["contract_address"] ?? receipt?.["contractAddress"]),
    gasEstimate: nullableScalarStringFromUnknown(record?.["gas_estimate"]),
    gasEstimateError: nullableScalarStringFromUnknown(record?.["gas_estimate_error"]),
    calldataHash: nullableStringFromUnknown(record?.["calldata_hash"]),
    calldataPrefix: nullableStringFromUnknown(record?.["calldata_prefix"]),
    input: nullableStringFromUnknown(record?.["input"] ?? record?.["calldata"] ?? transaction?.["input"]),
    logs: logLinesFromUnknown(record?.["logs"] ?? receipt?.["logs"]),
    events: arrayFromUnknown(record?.["events"]).map((event, index) => devContractEventRecordFromUnknown(event, { contract: stringFromUnknown(record?.["contract"]) ?? "" } as DevSession, index)),
    value: nullableScalarStringFromUnknown(record?.["value"]),
    blockTimestamp: nullableScalarStringFromUnknown(record?.["block_timestamp"] ?? record?.["timestamp"] ?? block?.["timestamp"]),
    createdAtUnix: numberFromUnknown(record?.["created_at_unix"]) ?? 0,
  };
}

function devTransactionRawOutput(record: Record<string, unknown> | undefined): string | null {
  const explicit = nullableStringFromUnknown(record?.["raw_output"] ?? record?.["rawOutput"] ?? record?.["tx_output"]);
  if (explicit !== null) {
    return explicit;
  }
  return record === undefined ? null : JSON.stringify(record, null, 2);
}

export function logLinesFromUnknown(raw: unknown): readonly string[] {
  return arrayFromUnknown(raw).flatMap((item) => {
    if (typeof item === "string") {
      return [item];
    }

    if (typeof item === "object" && item !== null) {
      const record = item as Record<string, unknown>;
      const event = stringFromUnknown(record["event"]) ?? stringFromUnknown(record["name"]);
      const address = stringFromUnknown(record["address"]);
      const transactionHash = stringFromUnknown(record["transactionHash"]) ?? stringFromUnknown(record["transaction_hash"]);
      return [[event, address, transactionHash].filter((value) => value !== undefined && value.length > 0).join(" ")].filter((value) => value.length > 0);
    }

    return [];
  });
}
