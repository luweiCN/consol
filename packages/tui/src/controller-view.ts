import { createTranslator } from "@consol/i18n";
import type { DevFunctionInputDraft, DevFunctionInputValues } from "@consol/core";
import type { ConsolEvent, TxPreviewEvent } from "@consol/protocol";
import type {
  BuildRequestResult,
  ConfirmedTxPreviewResult,
  DevAccountStatusSnapshot,
  DevBuildDiagnosticsSnapshot,
  DevLocalChainActionRequest,
  DevRuntimeSelection,
  DevSettingsSnapshot,
  DevStateSnapshot,
  SourcePreview,
} from "./runtime-types";

export function settingsProps(settings: DevSettingsSnapshot | undefined): { readonly settings?: DevSettingsSnapshot } {
  return settings === undefined ? {} : { settings };
}

function feedEventLine(event: ConsolEvent, t: ReturnType<typeof createTranslator>): string {
  switch (event.type) {
    case "tx.preview":
      return t("tui.feed.tx.preview", { action: event.action, target: event.target.contract });
    case "tx.sent":
      return t("tui.feed.tx.sent", { action: "tx", target: event.hash.slice(0, 10) });
    case "tx.mined":
      return t("tui.feed.tx.mined", { status: event.status, hash: event.hash.slice(0, 10) });
    case "error":
      return t("tui.feed.tx.failed", { action: event.code, target: event.message });
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export function timestampedFeedEventLine(event: ConsolEvent, t: ReturnType<typeof createTranslator>): string {
  return `${eventTimeLabel(event)} ${feedEventLine(event, t)}`;
}

function eventTimeLabel(event: ConsolEvent): string {
  if ("timestamp" in event && typeof event.timestamp === "string") {
    const date = new Date(event.timestamp);
    if (!Number.isNaN(date.getTime())) {
      return timeLabel(date);
    }
  }

  return currentTimeLabel();
}

export function currentTimeLabel(): string {
  return timeLabel(new Date());
}

function timeLabel(date: Date): string {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `[${hours}:${minutes}:${seconds}]`;
}

export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function localChainActionPendingMessage(request: DevLocalChainActionRequest): string {
  if (request.action === "start") {
    return `starting ${request.networkName}`;
  }
  if (request.action === "save_state") {
    return `saving ${request.networkName} state ${request.stateName ?? ""}`.trim();
  }
  if (request.action === "restore_state") {
    return `restoring ${request.networkName} state ${request.stateName ?? ""}`.trim();
  }
  return `resetting ${request.networkName}`;
}

export function feedEntryProps(entries: readonly string[] | undefined) {
  return entries === undefined ? {} : { feedEntries: entries };
}

export function functionInputErrorProps(error: string | undefined) {
  return error === undefined ? {} : { functionInputError: error };
}

export function stateSnapshotProps(snapshot: DevStateSnapshot | undefined) {
  return snapshot === undefined ? {} : { stateSnapshot: snapshot };
}

export function sourcePreviewsProps(previews: readonly SourcePreview[] | undefined) {
  return previews === undefined ? {} : { sourcePreviews: previews };
}

export function accountStatusProps(status: DevAccountStatusSnapshot | undefined) {
  return status === undefined ? {} : { accountStatus: status };
}

export function noDeployedContractStateSnapshot(message: string): DevStateSnapshot {
  return {
    status: {
      status: "deployed_contract_not_selected",
      message,
      hint: null,
    },
    address: null,
    values: [],
  };
}

export function initialRuntimeSelection(status: DevAccountStatusSnapshot | undefined): DevRuntimeSelection | undefined {
  return status === undefined ? undefined : { networkName: status.networkName, accountName: status.accountName };
}

export function buildDiagnosticsSnapshot(result: BuildRequestResult): DevBuildDiagnosticsSnapshot {
  return {
    status: result.status === "ok" ? "success" : "failed",
    message: result.message,
    diagnostics: result.diagnostics ?? [],
    stdout: result.stdout ?? null,
    stderr: result.stderr ?? null,
  };
}

export function valueFromText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function isTxPreviewEvent(value: TxPreviewEvent | ConfirmedTxPreviewResult): value is TxPreviewEvent {
  return "type" in value && value.type === "tx.preview";
}

export function functionInputHistoryKey(action: DevFunctionInputDraft["action"], signature: string): string {
  return `${action}:${signature}`;
}

export function sameFunctionInputValues(left: DevFunctionInputValues, right: DevFunctionInputValues): boolean {
  return left.valueText === right.valueText
    && left.gasLimitText === right.gasLimitText
    && left.gasLimitMode === right.gasLimitMode
    && left.argumentTexts.join("\u0000") === right.argumentTexts.join("\u0000");
}
