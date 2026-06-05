/** @jsxImportSource @opentui/solid */
import type { DevSession, DevState } from "@consol/core";
import type { Locale } from "@consol/i18n";
import { CliRenderEvents, createCliRenderer, type CliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { type DevAccountOption, type DevNetworkOption } from "./DevShell";
import type { EntrySelectorType } from "./DevSelectorLayer";
import { DevShellController } from "./DevShellController";
import type {
  BuildRequestHandler,
  DevBlockWatchHandler,
  ConfirmedTxPreviewHandler,
  DevAccountStatusHandler,
  DevAccountStatusSnapshot,
  DevContractEventRecord,
  DevDeployedContract,
  DevDeployedContractsHandler,
  DevEntryOption,
  DevEntrySelectHandler,
  DevEventRecordsHandler,
  DevSettingsChangeHandler,
  DevSettingsSnapshot,
  DevStateKeyBookChangeHandler,
  DevStateRowDetailHandler,
  DevStateSnapshot,
  DevStateSnapshotHandler,
  DevTransactionRecord,
  DevTransactionsHandler,
  FunctionInputSubmitHandler,
  SourceFileSelectHandler,
  SourcePreview,
  SourcePreviewsHandler,
} from "./runtime-types";

export * from "./DevShell";
export * from "./DevShellController";
export type {
  BuildRequestHandler,
  BuildRequestResult,
  ConfirmedTxPreviewHandler,
  ConfirmedTxPreviewResult,
  DevAccountStatusEntry,
  DevAccountStatusHandler,
  DevAccountStatusSnapshot,
  DevBlockWatchHandler,
  DevBuildDiagnostic,
  DevBuildDiagnosticsSnapshot,
  DevContractEventRecord,
  DevDeployedContract,
  DevDeployedContractsHandler,
  DevEntryOption,
  DevEntrySelectHandler,
  DevEventRecordsHandler,
  DevRuntimeSelection,
  DevSettingsChange,
  DevSettingsChangeHandler,
  DevSettingsChangeResult,
  DevSettingsSnapshot,
  DevStateKeyBookChange,
  DevStateKeyBookChangeHandler,
  DevStateKeyBookDetailEntry,
  DevStateRowDetailHandler,
  DevStateRowDetailRequest,
  DevStateRowDetailSnapshot,
  DevStateSnapshot,
  DevStateSnapshotHandler,
  DevStateSnapshotRequest,
  DevStateValueSnapshot,
  DevTransactionRecord,
  DevTransactionsHandler,
  FunctionInputSubmission,
  FunctionInputSubmitHandler,
  SourceFileSelection,
  SourceFileSelectHandler,
  SourcePreview,
  SourcePreviewsHandler,
} from "./runtime-types";

export type RunDevShellInput = {
  readonly locale: Locale;
  readonly session?: DevSession;
  readonly networkOptions?: readonly DevNetworkOption[];
  readonly accountOptions?: readonly DevAccountOption[];
  readonly entryOptions?: readonly DevEntryOption[];
  readonly entrySelectorType?: EntrySelectorType;
  readonly sourcePreviews?: readonly SourcePreview[];
  readonly accountStatus?: DevAccountStatusSnapshot;
  readonly stateSnapshot?: DevStateSnapshot;
  readonly transactions?: readonly DevTransactionRecord[];
  readonly deployedContracts?: readonly DevDeployedContract[];
  readonly eventRecords?: readonly DevContractEventRecord[];
  readonly settings?: DevSettingsSnapshot;
  readonly initialState?: DevState;
  readonly onFunctionInputSubmit?: FunctionInputSubmitHandler;
  readonly onConfirmedTxPreview?: ConfirmedTxPreviewHandler;
  readonly onEntrySelect?: DevEntrySelectHandler;
  readonly onSourceFileSelect?: SourceFileSelectHandler;
  readonly onStateSnapshotRequest?: DevStateSnapshotHandler;
  readonly onStateDetailRequest?: DevStateRowDetailHandler;
  readonly onStateKeyBookChange?: DevStateKeyBookChangeHandler;
  readonly onTransactionsRequest?: DevTransactionsHandler;
  readonly onDeployedContractsRequest?: DevDeployedContractsHandler;
  readonly onEventRecordsRequest?: DevEventRecordsHandler;
  readonly onSourcePreviewsRequest?: SourcePreviewsHandler;
  readonly onBuildRequest?: BuildRequestHandler;
  readonly onAccountStatusRequest?: DevAccountStatusHandler;
  readonly onBlockWatchStart?: DevBlockWatchHandler;
  readonly onSettingsChange?: DevSettingsChangeHandler;
  readonly copyToSystemClipboard?: (text: string) => void;
};

export function DevShellRuntime(input: RunDevShellInput) {
  return (
    <DevShellController
      locale={input.locale}
      {...(input.session === undefined ? {} : { session: input.session })}
      {...(input.networkOptions === undefined ? {} : { networkOptions: input.networkOptions })}
      {...(input.accountOptions === undefined ? {} : { accountOptions: input.accountOptions })}
      {...(input.entryOptions === undefined ? {} : { entryOptions: input.entryOptions })}
      {...(input.entrySelectorType === undefined ? {} : { entrySelectorType: input.entrySelectorType })}
      {...(input.sourcePreviews === undefined ? {} : { sourcePreviews: input.sourcePreviews })}
      {...(input.accountStatus === undefined ? {} : { accountStatus: input.accountStatus })}
      {...(input.stateSnapshot === undefined ? {} : { stateSnapshot: input.stateSnapshot })}
      {...(input.transactions === undefined ? {} : { transactions: input.transactions })}
      {...(input.deployedContracts === undefined ? {} : { deployedContracts: input.deployedContracts })}
      {...(input.eventRecords === undefined ? {} : { eventRecords: input.eventRecords })}
      {...(input.settings === undefined ? {} : { settings: input.settings })}
      {...(input.initialState === undefined ? {} : { initialState: input.initialState })}
      {...(input.onFunctionInputSubmit === undefined ? {} : { onFunctionInputSubmit: input.onFunctionInputSubmit })}
      {...(input.onConfirmedTxPreview === undefined ? {} : { onConfirmedTxPreview: input.onConfirmedTxPreview })}
      {...(input.onEntrySelect === undefined ? {} : { onEntrySelect: input.onEntrySelect })}
      {...(input.onSourceFileSelect === undefined ? {} : { onSourceFileSelect: input.onSourceFileSelect })}
      {...(input.onStateSnapshotRequest === undefined ? {} : { onStateSnapshotRequest: input.onStateSnapshotRequest })}
      {...(input.onStateDetailRequest === undefined ? {} : { onStateDetailRequest: input.onStateDetailRequest })}
      {...(input.onStateKeyBookChange === undefined ? {} : { onStateKeyBookChange: input.onStateKeyBookChange })}
      {...(input.onTransactionsRequest === undefined ? {} : { onTransactionsRequest: input.onTransactionsRequest })}
      {...(input.onDeployedContractsRequest === undefined ? {} : { onDeployedContractsRequest: input.onDeployedContractsRequest })}
      {...(input.onEventRecordsRequest === undefined ? {} : { onEventRecordsRequest: input.onEventRecordsRequest })}
      {...(input.onSourcePreviewsRequest === undefined ? {} : { onSourcePreviewsRequest: input.onSourcePreviewsRequest })}
      {...(input.onBuildRequest === undefined ? {} : { onBuildRequest: input.onBuildRequest })}
      {...(input.onAccountStatusRequest === undefined ? {} : { onAccountStatusRequest: input.onAccountStatusRequest })}
      {...(input.onBlockWatchStart === undefined ? {} : { onBlockWatchStart: input.onBlockWatchStart })}
      {...(input.onSettingsChange === undefined ? {} : { onSettingsChange: input.onSettingsChange })}
      {...(input.copyToSystemClipboard === undefined ? {} : { copyToSystemClipboard: input.copyToSystemClipboard })}
    />
  );
}

export async function runDevShell(input: RunDevShellInput): Promise<void> {
  const renderer = await createCliRenderer({ useMouse: true, consoleMode: "disabled", openConsoleOnError: false });
  const terminalRestore = createTerminalRestoreHandler(renderer);
  const repaintAfterTerminalRestore = () => {
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[2J\x1b[H");
    }
    terminalRestore.request();
  };
  process.stdout.on("resize", repaintAfterTerminalRestore);
  process.on("SIGWINCH", repaintAfterTerminalRestore);
  renderer.on(CliRenderEvents.FOCUS, repaintAfterTerminalRestore);
  const destroyed = new Promise<void>((resolve) => {
    renderer.once(CliRenderEvents.DESTROY, () => {
      terminalRestore.cancel();
      process.stdout.off("resize", repaintAfterTerminalRestore);
      process.off("SIGWINCH", repaintAfterTerminalRestore);
      renderer.off(CliRenderEvents.FOCUS, repaintAfterTerminalRestore);
      resolve();
    });
  });

  await render(
    () => <DevShellRuntime {...input} />,
    renderer,
  );
  await destroyed;
}

function createTerminalRestoreHandler(renderer: CliRenderer): { readonly request: () => void; readonly cancel: () => void } {
  let repaintTimer: ReturnType<typeof setTimeout> | null = null;

  const request = () => {
    requestFullRepaint(renderer);
    if (repaintTimer !== null) {
      clearTimeout(repaintTimer);
    }
    repaintTimer = setTimeout(() => {
      repaintTimer = null;
      requestFullRepaint(renderer);
    }, 80);
  };

  const cancel = () => {
    if (repaintTimer !== null) {
      clearTimeout(repaintTimer);
      repaintTimer = null;
    }
  };

  return { request, cancel };
}

function requestFullRepaint(renderer: CliRenderer): void {
  (renderer as unknown as { forceFullRepaintRequested?: boolean }).forceFullRepaintRequested = true;
  renderer.requestRender();
}
