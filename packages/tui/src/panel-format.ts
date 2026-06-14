import type { FunctionItem } from "@consol/core";
import type { MessageKey } from "@consol/i18n";
import type { ColorInput } from "@opentui/core";
import type { DevContractEventRecord, DevTransactionRecord } from "./runtime-types";
import { formattedJsonLines } from "./JsonCodeBlock";
import { theme } from "./theme";

export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export type TransactionField = {
  readonly label: string;
  readonly value: string;
  readonly fg: ColorInput;
};

export type TransactionDetailEntry =
  | { readonly kind: "line"; readonly fg: ColorInput; readonly content: string }
  | { readonly kind: "json"; readonly lines: readonly string[] };

type TransactionStatusKind = "none" | "pending" | "sent" | "waiting" | "mined" | "success" | "read" | "reverted" | "failed" | "unknown";

export function shortValue(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length === 0) {
    return "-";
  }

  return value.startsWith("0x") && value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

export function transactionTime(createdAtUnix: number): string {
  if (!Number.isFinite(createdAtUnix) || createdAtUnix <= 0) {
    return "-";
  }

  const date = new Date(createdAtUnix * 1000);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}`;
}

export function shortRaw(value: string): string {
  return value.length > 96 ? `${value.slice(0, 96)}...` : value;
}

export function eventArgsText(args: readonly DevContractEventRecord["args"][number][]): string {
  return args.map((arg) => `${arg.name || "_"}${arg.indexed ? "*" : ""}=${arg.value}`).join(", ");
}

export function statusColor(status: string): ColorInput {
  if (status === "ready") {
    return theme.color.read;
  }

  if (status === "deployment_not_found" || status === "deployment_stale") {
    return theme.color.muted;
  }

  return theme.color.danger;
}

export function functionKindColor(kind: FunctionItem["kind"]): ColorInput {
  return kind === "read" ? theme.color.read : kind === "payable" ? theme.color.payable : theme.color.write;
}

export function feedEntryColor(entry: string): ColorInput {
  const lower = entry.toLowerCase();
  if (lower.includes("failed") || lower.includes("失败") || lower.includes("error")) {
    return theme.color.danger;
  }

  if (lower.includes("preview") || lower.includes("预览")) {
    return theme.color.write;
  }

  if (lower.includes("sent") || lower.includes("已发送") || lower.includes("已确认") || lower.includes("ok")) {
    return theme.color.read;
  }

  return theme.color.text;
}

export function transactionTitle(record: DevTransactionRecord): string {
  const functionLabel = record.signature ?? record.functionName ?? "constructor";
  return `${transactionTime(record.createdAtUnix)}  ${record.action.toUpperCase()}  ${record.contract}.${functionLabel}`;
}

export function transactionFieldLines(record: DevTransactionRecord, translate: Translate): readonly { readonly fields: readonly TransactionField[] }[] {
  const receipt = [
    field(translate, "tui.transactions.tx", shortValue(record.txHash), theme.color.code),
    field(translate, "tui.transactions.block", record.blockNumber ?? "-", theme.color.text),
    field(translate, "tui.transactions.confirmations", record.confirmations ?? "-", theme.color.text),
    field(translate, "tui.transactions.gasUsed", record.gasUsed ?? "-", theme.color.text),
  ];
  const network = [
    field(translate, "tui.transactions.network", record.network ?? "-", theme.color.text),
    field(translate, "tui.transactions.chain", record.chainId ?? "-", theme.color.text),
    field(translate, "tui.transactions.account", record.account ?? "-", theme.color.text),
    ...(record.networkFingerprint === undefined || record.networkFingerprint === null
      ? []
      : [{ label: "rpc", value: record.networkFingerprint, fg: theme.color.muted }]),
  ];
  const route = [
    field(translate, "tui.transactions.from", shortValue(record.from), theme.color.code),
    field(translate, "tui.transactions.to", shortValue(record.to ?? record.address ?? record.contractAddress), theme.color.code),
    field(translate, "tui.transactions.nonce", record.nonce ?? "-", theme.color.text),
  ];
  const gas = [
    field(translate, "tui.transactions.gasLimit", record.gasLimit ?? "-", theme.color.text),
    field(translate, "tui.transactions.gasPrice", record.gasPrice ?? "-", theme.color.text),
    field(translate, "tui.transactions.maxFee", record.maxFeePerGas ?? "-", theme.color.text),
    field(translate, "tui.transactions.priorityFee", record.maxPriorityFeePerGas ?? "-", theme.color.text),
    field(translate, "tui.transactions.effectiveGasPrice", record.effectiveGasPrice ?? "-", theme.color.text),
    field(translate, "tui.transactions.estimate", record.gasEstimate ?? record.gasEstimateError ?? "-", theme.color.text),
  ];
  const calldata = [
    field(translate, "tui.transactions.calldata", record.calldataPrefix ?? record.input ?? "-", theme.color.code),
    ...(record.calldataHash === undefined || record.calldataHash === null ? [] : [field(translate, "tui.transactions.calldataHash", record.calldataHash, theme.color.code)]),
    ...(record.value === undefined || record.value === null ? [] : [field(translate, "tui.transactions.value", record.value, theme.color.text)]),
  ];
  const args = record.args.length === 0 ? [] : [field(translate, "tui.transactions.args", record.args.join(", "), theme.color.text)];
  const result = record.result ?? (record.action === "read" ? record.rawOutput : null);

  return [
    { fields: receipt },
    { fields: network },
    { fields: route },
    { fields: gas },
    { fields: calldata },
    ...(args.length === 0 ? [] : [{ fields: args }]),
    ...(record.logs === undefined || record.logs.length === 0 ? [] : [{ fields: [field(translate, "tui.transactions.logs", record.logs.join(", "), theme.color.text)] }]),
    ...(record.events === undefined || record.events.length === 0 ? [] : [{ fields: [field(translate, "tui.transactions.events", eventSummary(record.events), theme.color.read)] }]),
    ...(result === null ? [] : [{ fields: [field(translate, "tui.transactions.result", result, theme.color.text)] }]),
  ];
}

function field(translate: Translate, key: MessageKey, value: string, fg: ColorInput): TransactionField {
  return { label: translate(key), value, fg };
}

export function transactionDetailEntries(record: DevTransactionRecord, translate: Translate): readonly TransactionDetailEntry[] {
  const summaryRows = [
    detailRow(translate, "tui.transactions.field.id", record.id),
    detailRow(translate, "tui.transactions.field.action", record.action),
    detailRow(translate, "tui.transactions.field.contract", record.contract),
    detailRow(translate, "tui.transactions.field.target", record.target),
    detailRow(translate, "tui.transactions.field.function", record.functionName),
    detailRow(translate, "tui.transactions.field.signature", record.signature),
    detailRow(translate, "tui.transactions.tx", record.txHash),
    detailRow(translate, "tui.transactions.input", record.input),
    detailRow(translate, "tui.transactions.logs", record.logs === undefined || record.logs.length === 0 ? null : record.logs.join(", ")),
    detailRow(translate, "tui.transactions.events", record.events === undefined || record.events.length === 0 ? null : eventDetailSummary(record.events)),
    detailRow(translate, "tui.transactions.args", record.args.length === 0 ? null : record.args.join(", ")),
    detailRow(translate, "tui.transactions.result", record.result),
  ];
  const receiptRows = [
    detailRow(translate, "tui.transactions.field.timestamp", record.blockTimestamp),
    detailRow(translate, "tui.transactions.block", record.blockNumber),
    detailRow(translate, "tui.transactions.confirmations", record.confirmations),
    detailRow(translate, "tui.transactions.status", transactionStatusLabel(record, translate), transactionStatusColor(record)),
    detailRow(translate, "tui.transactions.gasUsed", record.gasUsed),
    detailRow(translate, "tui.transactions.gasLimit", record.gasLimit),
    detailRow(translate, "tui.transactions.gasPrice", record.gasPrice),
    detailRow(translate, "tui.transactions.maxFee", record.maxFeePerGas),
    detailRow(translate, "tui.transactions.priorityFee", record.maxPriorityFeePerGas),
    detailRow(translate, "tui.transactions.effectiveGasPrice", record.effectiveGasPrice),
    detailRow(translate, "tui.transactions.estimate", record.gasEstimate ?? record.gasEstimateError),
    detailRow(translate, "tui.transactions.network", record.network),
    detailRow(translate, "tui.transactions.chain", record.chainId),
    detailRow(translate, "tui.transactions.account", record.account),
    detailRow(translate, "tui.transactions.from", record.from),
    detailRow(translate, "tui.transactions.to", record.to ?? record.address ?? record.contractAddress),
    detailRow(translate, "tui.transactions.nonce", record.nonce),
    detailRow(translate, "tui.transactions.value", record.value),
    detailRow(translate, "tui.transactions.calldata", record.calldataPrefix),
    detailRow(translate, "tui.transactions.calldataHash", record.calldataHash),
  ];
  const rawOutputRows = transactionRawOutputEntries(record.rawOutput, translate);
  const timeRow = detailRow(translate, "tui.transactions.field.time", transactionTime(record.createdAtUnix));
  const lineEntries = (rows: readonly ReturnType<typeof detailRow>[]) =>
    rows.map((row) => ({ kind: "line" as const, fg: row.value === "-" ? theme.color.muted : row.fg ?? theme.color.text, content: `${row.label}: ${row.value}` }));

  return [
    { kind: "line", fg: transactionTitleColor(record), content: transactionTitle(record) },
    { kind: "line", fg: theme.color.muted, content: "" },
    ...lineEntries(summaryRows),
    ...rawOutputRows,
    ...lineEntries(receiptRows),
    { kind: "line", fg: timeRow.value === "-" ? theme.color.muted : timeRow.fg ?? theme.color.text, content: `${timeRow.label}: ${timeRow.value}` },
  ];
}

function transactionRawOutputEntries(rawOutput: string | null, translate: Translate): readonly TransactionDetailEntry[] {
  if (rawOutput === null) {
    return [];
  }

  const label = translate("tui.transactions.field.rawOutput");
  const lines = formattedJsonLines(rawOutput);
  if (lines === null) {
    return [{ kind: "line", fg: theme.color.text, content: `${label}: ${rawOutput}` }];
  }

  return [
    { kind: "line", fg: theme.color.muted, content: `${label}:` },
    { kind: "json", lines },
  ];
}

function eventSummary(events: readonly DevContractEventRecord[]): string {
  return events.map((event) => event.event ?? event.signature ?? shortRaw(event.raw ?? "raw")).join(", ");
}

function eventDetailSummary(events: readonly DevContractEventRecord[]): string {
  return events
    .map((event) => {
      const name = event.event ?? event.signature ?? "raw";
      const args = eventArgsText(event.args);
      return `${name}${args.length === 0 ? "" : `(${args})`} tx=${shortValue(event.txHash)} block=${event.blockNumber ?? "-"}`;
    })
    .join(" | ");
}

function detailRow(
  translate: Translate,
  key: MessageKey,
  value: string | null | undefined,
  fg?: ColorInput,
): { readonly label: string; readonly value: string; readonly fg?: ColorInput } {
  return {
    label: translate(key),
    value: value === null || value === undefined || value.length === 0 ? "-" : value,
    ...(fg === undefined ? {} : { fg }),
  };
}

export function transactionStatusLabel(record: DevTransactionRecord, translate: Translate): string {
  const kind = transactionStatusKind(record);
  if (kind === "none") {
    return "-";
  }

  if (kind === "unknown") {
    return record.status ?? "-";
  }

  return translate(transactionStatusKey(kind));
}

function transactionStatusKind(record: DevTransactionRecord): TransactionStatusKind {
  const status = record.status?.trim().toLowerCase() ?? "";
  if (status.length === 0) {
    return record.action === "read" && (record.result !== null || record.rawOutput !== null) ? "read" : "none";
  }

  if (status === "pending" || status === "queued") {
    return record.txHash === null ? "pending" : "waiting";
  }

  if (status === "sent" || status === "submitted" || status === "broadcast" || status === "broadcasted") {
    return "sent";
  }

  if (status === "waiting" || status === "waiting_for_block" || status === "waiting_for_receipt" || status === "mining") {
    return "waiting";
  }

  if (status === "mined" || status === "confirmed" || status === "included") {
    return "mined";
  }

  if (status === "success" || status === "ok" || status === "0x1" || status === "1") {
    return record.action === "read" ? "read" : "success";
  }

  if (status === "reverted" || status === "0x0" || status === "0") {
    return "reverted";
  }

  if (status === "failed" || status === "failure" || status === "error") {
    return "failed";
  }

  return "unknown";
}

function transactionStatusKey(kind: Exclude<TransactionStatusKind, "none" | "unknown">): MessageKey {
  switch (kind) {
    case "pending":
      return "tui.transactions.status.pending";
    case "sent":
      return "tui.transactions.status.sent";
    case "waiting":
      return "tui.transactions.status.waiting";
    case "mined":
      return "tui.transactions.status.mined";
    case "success":
      return "tui.transactions.status.success";
    case "read":
      return "tui.transactions.status.read";
    case "reverted":
      return "tui.transactions.status.reverted";
    case "failed":
      return "tui.transactions.status.failed";
  }
}

export function transactionTitleColor(record: DevTransactionRecord): ColorInput {
  const action = record.action.toLowerCase();
  if (action === "read" || action === "call") {
    return theme.color.read;
  }

  if (action === "payable") {
    return theme.color.payable;
  }

  return theme.color.write;
}

export function transactionStatusColor(record: DevTransactionRecord): ColorInput {
  const status = transactionStatusKind(record);
  if (status === "reverted" || status === "failed") {
    return theme.color.danger;
  }

  if (status === "success" || status === "read" || status === "mined") {
    return theme.color.read;
  }

  return theme.color.write;
}
