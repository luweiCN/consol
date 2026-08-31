import type { DevAction, DevFunctionInputDraft, DevModal, DevSession } from "@consol/core";
import type { Locale } from "@consol/i18n";
import type { DevAccountOption, DevNetworkOption, EntrySelectorType } from "./DevSelectorLayer";
import type { SelectorOption } from "./SelectorModal";
import type {
  DevAccountStatusSnapshot,
  DevBuildDiagnosticsSnapshot,
  DevChainStatesHandler,
  DevContractEventRecord,
  DevDeployedContract,
  DevLocalChainActionHandler,
  DevRuntimeSelection,
  DevSettingsChangeHandler,
  DevSettingsSnapshot,
  DevStateKeyBookChangeHandler,
  DevStateRowDetailHandler,
  DevStateSnapshot,
  DevTransactionRecord,
  SourcePreview,
} from "./runtime-types";

export type TxPreviewEvent = Extract<DevModal, { readonly type: "txPreview" }>["event"];

export type DevShellProps = {
  readonly locale: Locale;
  readonly session?: DevSession | undefined;
  readonly networkOptions?: readonly DevNetworkOption[];
  readonly accountOptions?: readonly DevAccountOption[];
  readonly entryOptions?: readonly SelectorOption[];
  readonly entrySelectorType?: EntrySelectorType;
  readonly sourcePreviews?: readonly SourcePreview[];
  readonly accountStatus?: DevAccountStatusSnapshot;
  readonly stateSnapshot?: DevStateSnapshot;
  readonly diagnosticsSnapshot?: DevBuildDiagnosticsSnapshot | undefined;
  readonly transactions?: readonly DevTransactionRecord[];
  readonly deployedContracts?: readonly DevDeployedContract[];
  readonly preferredActiveDeployedContractId?: string | null;
  readonly eventRecords?: readonly DevContractEventRecord[];
  readonly traceText?: string | null;
  readonly onRequestTrace?: (txHash: string) => void;
  readonly onCloseTrace?: () => void;
  readonly settings?: DevSettingsSnapshot;
  readonly feedEntries?: readonly string[];
  readonly functionInputError?: string;
  readonly sourceTargetSelectionPending?: boolean;
  readonly modal?: DevModal;
  readonly onConfirmTxPreview?: (event: TxPreviewEvent) => void;
  readonly onSubmitFunctionInput?: (draft: DevFunctionInputDraft) => void;
  readonly onCancelModal?: () => void;
  readonly onDevAction?: (action: DevAction) => void;
  readonly onEntrySelect?: (option: SelectorOption) => void;
  readonly onBuildRequest?: () => void;
  readonly onRefreshRequest?: () => void;
  readonly onRuntimeSelectionChange?: (selection: DevRuntimeSelection) => void;
  readonly onActiveDeployedContractChange?: (contract: DevDeployedContract | null) => void;
  readonly onDeployedContractAdd?: (address: string) => string | void;
  readonly onDeployedContractRemove?: (id: string) => void;
  readonly onChainStatesRequest?: DevChainStatesHandler;
  readonly onLocalChainAction?: DevLocalChainActionHandler;
  readonly onCopyText?: (text: string) => void;
  readonly onSettingsChange?: DevSettingsChangeHandler;
  readonly onStateKeyBookChange?: DevStateKeyBookChangeHandler;
  readonly onStateDetailRequest?: DevStateRowDetailHandler;
  readonly onExitRequest?: () => void;
};
