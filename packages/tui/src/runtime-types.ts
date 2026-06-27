import type { AbiSummary, ConstructorItem, DevFunctionInputDraft, DevSession, FunctionItem } from "@consol/core";
import type { Locale, LocalePreference, MessageKey } from "@consol/i18n";
import type { TxPreviewEvent } from "@consol/protocol";

export type ConfirmedTxPreviewResult = {
  readonly status: "ok" | "error";
  readonly message: string;
  readonly txHash?: string | null;
  readonly transaction?: DevTransactionRecord;
  readonly nextPreview?: TxPreviewEvent;
};

export type DevBuildDiagnostic = {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly code: string | null;
  readonly file: string | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly source: string;
};

export type DevBuildDiagnosticsSnapshot = {
  readonly status: "success" | "failed";
  readonly message: string;
  readonly diagnostics: readonly DevBuildDiagnostic[];
  readonly stdout: string | null;
  readonly stderr: string | null;
};

export type BuildRequestResult = ConfirmedTxPreviewResult & {
  readonly diagnostics?: readonly DevBuildDiagnostic[];
  readonly stdout?: string;
  readonly stderr?: string;
};

export type DevRuntimeSelection = {
  readonly networkName: string;
  readonly accountName: string;
};

export type DevSettingsSnapshot = {
  readonly language: LocalePreference;
  readonly resolvedLocale: Locale;
  readonly systemLocale: Locale;
  readonly showRawStateValues: boolean;
  readonly hideNoArgReadActions: boolean;
  readonly configPath?: string;
};

export type DevSettingsChange = {
  readonly language?: LocalePreference;
  readonly showRawStateValues?: boolean;
  readonly hideNoArgReadActions?: boolean;
};

export type DevSettingsChangeResult = {
  readonly language: LocalePreference;
  readonly resolvedLocale: Locale;
  readonly showRawStateValues: boolean;
  readonly hideNoArgReadActions: boolean;
  readonly configPath?: string;
};

export type DevSettingsChangeHandler = (
  change: DevSettingsChange,
) => DevSettingsChangeResult | Promise<DevSettingsChangeResult | void> | void;

export type DevBlockWatchInput = {
  readonly session: DevSession;
  readonly selection: DevRuntimeSelection;
};

export type DevBlockWatchCallbacks = {
  readonly onBlockNumber: (blockNumber: string) => void;
  readonly onEvents: (records: readonly DevContractEventRecord[]) => void;
};

export type DevBlockWatchHandler = (
  input: DevBlockWatchInput,
  callbacks: DevBlockWatchCallbacks,
) => (() => void) | void;

export type DevAccountStatusEntry = {
  readonly accountName: string;
  readonly address: string | null;
  readonly signer: string | null;
  readonly balanceWei: string | null;
  readonly balanceDisplay: string | null;
  readonly balanceDetail?: string | null;
  readonly status: "ok" | "error";
  readonly message: string | null;
};

export type DevAccountStatusSnapshot = DevRuntimeSelection & DevAccountStatusEntry & {
  readonly accounts?: readonly DevAccountStatusEntry[];
};

export type DevStateSnapshot = {
  readonly status: {
    readonly status: string;
    readonly message: string | null;
    readonly hint: string | null;
  };
  readonly address: string | null;
  readonly details?: readonly DevStateDetailSnapshot[];
  readonly values: readonly DevStateValueSnapshot[];
  readonly storageValues?: readonly DevStorageStateRowSnapshot[];
  readonly storageHints?: readonly string[];
  readonly storageLayoutId?: string | null;
};

export type DevStateDetailSnapshot = {
  readonly labelKey: MessageKey;
  readonly value: string;
};

export type DevStateValueSnapshot = {
  readonly name: string;
  readonly signature: string;
  readonly output_types: readonly string[];
  readonly readable: string | null;
  readonly raw: string;
  readonly error?: string | null;
};

export type DevStorageStateRowSnapshot = {
  readonly id: string;
  readonly kind: "scalar" | "array" | "struct" | "mapping" | "error";
  readonly name: string;
  readonly typeLabel: string;
  readonly summary: string;
  readonly detailAvailable: boolean;
  readonly checked?: number;
  readonly nonDefault?: number;
  readonly defaultValuesHidden?: boolean;
  readonly error?: string | null;
};

export type DevStateRowDetailRequest = {
  readonly session: DevSession;
  readonly deployedContract: DevDeployedContract;
  readonly rowId: string;
  readonly showDefaults: boolean;
};

export type DevStateRowDetailSnapshot = {
  readonly rowId: string;
  readonly title: string;
  readonly lines: readonly string[];
  readonly copyValue: string | null;
  readonly keyBookEntries?: readonly DevStateKeyBookDetailEntry[];
};

export type DevStateKeyBookDetailEntry = {
  readonly type: string;
  readonly value: string;
  readonly label: string | null;
  readonly lineIndex: number;
};

export type DevStateRowDetailHandler = (
  request: DevStateRowDetailRequest,
) => DevStateRowDetailSnapshot | Promise<DevStateRowDetailSnapshot | void> | void;

export type DevStateKeyBookChange =
  | {
    readonly action: "add_key";
    readonly layoutId: string;
    readonly target: string;
    readonly contract: string;
    readonly key: {
      readonly type: string;
      readonly value: string;
      readonly label: string | null;
      readonly enabled: boolean;
    };
  }
  | {
    readonly action: "delete_key";
    readonly layoutId: string;
    readonly type: string;
    readonly value: string;
  }
  | {
    readonly action: "set_key_enabled";
    readonly layoutId: string;
    readonly type: string;
    readonly value: string;
    readonly enabled: boolean;
  };

export type DevStateKeyBookChangeHandler = (
  change: DevStateKeyBookChange,
  context?: { readonly session?: DevSession; readonly networkName?: string },
) => void | Promise<void>;

export type DevTransactionRecord = {
  readonly id: string;
  readonly previewId?: string | null;
  readonly action: string;
  readonly contract: string;
  readonly target: string | null;
  readonly functionName: string | null;
  readonly signature: string | null;
  readonly args: readonly string[];
  readonly result: string | null;
  readonly rawOutput: string | null;
  readonly txHash: string | null;
  readonly blockNumber: string | null;
  readonly confirmations?: string | null;
  readonly status: string | null;
  readonly gasUsed: string | null;
  readonly gasLimit?: string | null;
  readonly network: string | null;
  readonly chainId?: string | null;
  readonly networkFingerprint?: string | null;
  readonly account: string | null;
  readonly address?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly signerAddress?: string | null;
  readonly nonce?: string | null;
  readonly gasPrice?: string | null;
  readonly maxFeePerGas?: string | null;
  readonly maxPriorityFeePerGas?: string | null;
  readonly effectiveGasPrice?: string | null;
  readonly contractAddress?: string | null;
  readonly gasEstimate?: string | null;
  readonly gasEstimateError?: string | null;
  readonly calldataHash?: string | null;
  readonly calldataPrefix?: string | null;
  readonly input?: string | null;
  readonly logs?: readonly string[];
  readonly events?: readonly DevContractEventRecord[];
  readonly value?: string | null;
  readonly blockTimestamp?: string | null;
  readonly createdAtUnix: number;
};

export type DevDeployedContract = {
  readonly id: string;
  readonly contract: string;
  readonly address: string;
  readonly target: string;
  readonly workspaceRoot?: string;
  readonly projectRoot?: string;
  readonly sourceFile: string | null;
  readonly network: string | null;
  readonly chainId: string | null;
  readonly networkFingerprint?: string | null;
  readonly account: string | null;
  readonly deployTxHash?: string | null;
  readonly status: "pending" | "ready" | "failed" | "external";
  readonly constructorArgs: readonly string[];
  readonly value?: string | null;
  readonly balanceDisplay?: string | null;
  readonly abiSummary: AbiSummary;
  readonly constructor: ConstructorItem | null;
  readonly functions: readonly FunctionItem[];
  readonly createdAtUnix: number;
};

export type DevContractEventArg = {
  readonly name: string;
  readonly kind: string;
  readonly indexed: boolean;
  readonly value: string;
};

export type DevContractEventRecord = {
  readonly id: string;
  readonly source: "receipt" | "watch" | "logs";
  readonly contract: string;
  readonly address: string | null;
  readonly event: string | null;
  readonly signature: string | null;
  readonly args: readonly DevContractEventArg[];
  readonly raw: string | null;
  readonly txHash: string | null;
  readonly blockNumber: string | null;
  readonly logIndex: string | null;
  readonly createdAtUnix: number;
};

export type SourcePreview = {
  readonly target: string;
  readonly lines: readonly string[];
};

export type ConfirmedTxPreviewHandler = (
  event: TxPreviewEvent,
) => ConfirmedTxPreviewResult | Promise<ConfirmedTxPreviewResult | void> | void;

export type FunctionInputSubmission = {
  readonly action: DevFunctionInputDraft["action"];
  readonly session: DevSession;
  readonly function: DevFunctionInputDraft["function"];
  readonly args: readonly string[];
  readonly value: string | null;
  readonly gasLimit?: string | null;
  readonly accountName?: string;
  readonly networkName?: string;
  readonly targetOverride?: string;
  readonly contractOverride?: string;
  readonly addressOverride?: string;
  readonly cwdOverride?: string;
};

export type FunctionInputSubmitResult = TxPreviewEvent | ConfirmedTxPreviewResult;

export type FunctionInputSubmitHandler = (
  submission: FunctionInputSubmission,
) => FunctionInputSubmitResult | Promise<FunctionInputSubmitResult | void> | void;

export type DevEntryOption = {
  readonly name: string;
  readonly label: string;
  readonly active: boolean;
  readonly badge?: string;
  readonly description?: string;
  readonly meta?: string;
  readonly previewLines?: readonly string[];
  readonly searchText?: string;
};

export type DevEntrySelectHandler = (
  option: DevEntryOption,
) => DevSession | Promise<DevSession | void> | void;

export type SourceFileSelection = {
  readonly sourceFile: string;
  readonly target: string;
  readonly session: DevSession;
};

export type SourceFileSelectHandler = (
  selection: SourceFileSelection,
) => DevSession | Promise<DevSession | void> | void;

export type DevStateSnapshotRequest = {
  readonly session: DevSession;
  readonly deployedContract?: DevDeployedContract | null;
};

export type DevStateSnapshotHandler = (
  request: DevStateSnapshotRequest,
) => DevStateSnapshot | Promise<DevStateSnapshot | void> | void;

export type DevTransactionsHandler = (
  session: DevSession,
) => readonly DevTransactionRecord[] | Promise<readonly DevTransactionRecord[] | void> | void;

export type DevDeployedContractsHandler = (
  session: DevSession,
  context?: { readonly networkName?: string },
) => readonly DevDeployedContract[] | Promise<readonly DevDeployedContract[] | void> | void;

export type DevTraceHandler = (txHash: string) => Promise<string | null>;

export type DevLocalChainAction = "start" | "save_state" | "restore_state" | "reset";

export type DevLocalChainActionRequest = {
  readonly action: DevLocalChainAction;
  readonly networkName: string;
  readonly stateName?: string;
};

export type DevLocalChainActionResult = {
  readonly status: "ok" | "error";
  readonly message: string;
};

export type DevLocalChainActionHandler = (
  request: DevLocalChainActionRequest,
) => DevLocalChainActionResult | Promise<DevLocalChainActionResult | void> | void;

export type DevChainStateOption = {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly createdAtUnix?: number;
};

export type DevChainStatesHandler = (
  networkName: string,
) => readonly DevChainStateOption[] | Promise<readonly DevChainStateOption[] | void> | void;

export type DevEventRecordsHandler = (
  session: DevSession,
) => readonly DevContractEventRecord[] | Promise<readonly DevContractEventRecord[] | void> | void;

export type SourcePreviewsHandler = (
  session: DevSession,
) => readonly SourcePreview[] | Promise<readonly SourcePreview[] | void> | void;

export type BuildRequestHandler = (
  session: DevSession,
) => BuildRequestResult | Promise<BuildRequestResult | void> | void;

export type DevAccountStatusHandler = (
  selection: DevRuntimeSelection,
) => DevAccountStatusSnapshot | Promise<DevAccountStatusSnapshot | void> | void;
