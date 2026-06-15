/** @jsxImportSource @opentui/solid */
import {
  createInitialDevState,
  devReducer,
  type DevAction,
  type DevFunctionInputDraft,
  type DevFunctionInputValues,
  type DevState,
} from "@consol/core";
import { createTranslator } from "@consol/i18n";
import type { TxPreviewEvent } from "@consol/protocol";
import type { Selection } from "@opentui/core";
import { useRenderer, useSelectionHandler } from "@opentui/solid";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { argsFromDraftWithAbiDefaults } from "./abi-default-values";
import { DevShell, type DevShellProps } from "./DevShell";
import type {
  ConfirmedTxPreviewHandler,
  ConfirmedTxPreviewResult,
  DevBlockWatchHandler,
  DevTraceHandler,
  BuildRequestHandler,
  DevAccountStatusHandler,
  DevAccountStatusSnapshot,
  DevEntrySelectHandler,
  DevBuildDiagnosticsSnapshot,
  DevChainStatesHandler,
  DevContractEventRecord,
  DevDeployedContract,
  DevDeployedContractsHandler,
  DevEventRecordsHandler,
  DevLocalChainActionHandler,
  DevLocalChainActionRequest,
  DevRuntimeSelection,
  DevSettingsChangeHandler,
  DevSettingsSnapshot,
  DevStateKeyBookChange,
  DevStateKeyBookChangeHandler,
  DevStateSnapshot,
  DevStateSnapshotHandler,
  DevTransactionRecord,
  DevTransactionsHandler,
  FunctionInputSubmitHandler,
  SourceFileSelectHandler,
  SourcePreview,
  SourcePreviewsHandler,
} from "./runtime-types";
import {
  deployedContractFromResult,
  mergeDeployedContracts,
  mergeEventRecords,
  mergeTransactionRecords,
  sameActiveDeployedContract,
  sameTransactionLifecycle,
  transactionFromDraft,
  transactionFromPreview,
  transactionFromSubmitted,
} from "./controller-records";
import {
  accountStatusProps,
  buildDiagnosticsSnapshot,
  currentTimeLabel,
  errorMessage,
  feedEntryProps,
  functionInputErrorProps,
  functionInputHistoryKey,
  initialRuntimeSelection,
  isTxPreviewEvent,
  localChainActionPendingMessage,
  noDeployedContractStateSnapshot,
  sameFunctionInputValues,
  settingsProps,
  sourcePreviewsProps,
  stateSnapshotProps,
  timestampedFeedEventLine,
  valueFromText,
} from "./controller-view";

export type DevShellControllerProps = Omit<
  DevShellProps,
  "modal" | "onActiveDeployedContractChange" | "onBuildRequest" | "onCancelModal" | "onConfirmTxPreview" | "onDeployedContractAdd" | "onDeployedContractRemove" | "onDevAction" | "onEntrySelect" | "onRefreshRequest" | "onRuntimeSelectionChange" | "onSubmitFunctionInput" | "sourceTargetSelectionPending"
> & {
  readonly initialState?: DevState;
  readonly onFunctionInputSubmit?: FunctionInputSubmitHandler;
  readonly onConfirmedTxPreview?: ConfirmedTxPreviewHandler;
  readonly onEntrySelect?: DevEntrySelectHandler;
  readonly onSourceFileSelect?: SourceFileSelectHandler;
  readonly onStateChange?: (state: DevState) => void;
  readonly copySelectedText?: (text: string) => boolean | void;
  readonly copyToSystemClipboard?: (text: string) => void;
  readonly sourcePreviews?: readonly SourcePreview[];
  readonly accountStatus?: DevAccountStatusSnapshot;
  readonly stateSnapshot?: DevStateSnapshot;
  readonly onStateSnapshotRequest?: DevStateSnapshotHandler;
  readonly onStateKeyBookChange?: DevStateKeyBookChangeHandler;
  readonly onTransactionsRequest?: DevTransactionsHandler;
  readonly deployedContracts?: readonly DevDeployedContract[];
  readonly eventRecords?: readonly DevContractEventRecord[];
  readonly onDeployedContractsRequest?: DevDeployedContractsHandler;
  readonly onChainStatesRequest?: DevChainStatesHandler;
  readonly onLocalChainAction?: DevLocalChainActionHandler;
  readonly onEventRecordsRequest?: DevEventRecordsHandler;
  readonly onSourcePreviewsRequest?: SourcePreviewsHandler;
  readonly onBuildRequest?: BuildRequestHandler;
  readonly onAccountStatusRequest?: DevAccountStatusHandler;
  readonly onBlockWatchStart?: DevBlockWatchHandler;
  readonly onTraceRequest?: DevTraceHandler;
};

export function DevShellController(props: DevShellControllerProps) {
  const renderer = useRenderer();
  let lastCopiedSelection = "";
  const [state, setState] = createSignal(props.initialState ?? createInitialDevState());
  const [currentLocale, setCurrentLocale] = createSignal(props.locale);
  const [currentSession, setCurrentSession] = createSignal(props.session);
  const [sourcePreviews, setSourcePreviews] = createSignal<readonly SourcePreview[] | undefined>(props.sourcePreviews);
  const [accountStatus, setAccountStatus] = createSignal<DevAccountStatusSnapshot | undefined>(props.accountStatus);
  const [stateSnapshot, setStateSnapshot] = createSignal<DevStateSnapshot | undefined>(props.stateSnapshot);
  const [cachedTransactions, setCachedTransactions] = createSignal<readonly DevTransactionRecord[]>(props.transactions ?? []);
  const [sessionTransactions, setSessionTransactions] = createSignal<readonly DevTransactionRecord[]>([]);
  const [deployedContracts, setDeployedContracts] = createSignal<readonly DevDeployedContract[]>(props.deployedContracts ?? []);
  const [traceText, setTraceText] = createSignal<string | null>(null);
  const requestTrace = (txHash: string): void => {
    const handler = props.onTraceRequest;
    if (handler === undefined) {
      return;
    }
    void handler(txHash).then((text) => setTraceText(text ?? ""));
  };
  const closeTrace = (): void => {
    setTraceText(null);
  };
  const [activeDeployedContract, setActiveDeployedContract] = createSignal<DevDeployedContract | null>(null);
  const [preferredActiveDeployedContractId, setPreferredActiveDeployedContractId] = createSignal<string | null>(null);
  const [eventRecords, setEventRecords] = createSignal<readonly DevContractEventRecord[]>(props.eventRecords ?? []);
  const [settings, setSettings] = createSignal<DevSettingsSnapshot | undefined>(props.settings);
  const [diagnosticsSnapshot, setDiagnosticsSnapshot] = createSignal<DevBuildDiagnosticsSnapshot | undefined>(props.diagnosticsSnapshot);
  const [sourceTargetSelectionPending, setSourceTargetSelectionPending] = createSignal(false);
  const [executionFeedEntries, setExecutionFeedEntries] = createSignal<readonly string[]>([]);
  const [functionInputError, setFunctionInputError] = createSignal<string | undefined>();
  const [functionInputHistory, setFunctionInputHistory] = createSignal<ReadonlyMap<string, readonly DevFunctionInputValues[]>>(new Map());
  const translator = createMemo(() => createTranslator(currentLocale()));
  let stateRefreshInFlight = false;
  let stateRefreshQueued = false;
  let accountStatusRefreshInFlight = false;
  const [runtimeSelection, setRuntimeSelection] = createSignal<DevRuntimeSelection | undefined>(initialRuntimeSelection(props.accountStatus));
  const feedEntries = () => {
    if (props.feedEntries !== undefined) {
      return props.feedEntries;
    }

    const entries = [...state().feed.map((event) => timestampedFeedEventLine(event, translator())), ...executionFeedEntries()];
    return entries.length === 0 ? undefined : entries;
  };
  const activeModal = createMemo(() => state().modal);
  const transactionRecords = () => mergeTransactionRecords(sessionTransactions(), cachedTransactions());
  const dispatch = (action: DevAction) => {
    const current = state();
    const next = devReducer(current, withFunctionInputHistory(action));
    setState(next);
    props.onStateChange?.(next);

    if (next.confirmedTxPreview !== null && next.confirmedTxPreview.id !== current.confirmedTxPreview?.id) {
      void recordConfirmedTxPreview(next.confirmedTxPreview);
    }
    if (next.selectedSourceTarget !== null && next.selectedSourceTarget !== current.selectedSourceTarget) {
      void recordSelectedSourceFile(next.selectedSourceTarget);
    }
    if (next.submittedFunction !== null && next.submittedFunction !== current.submittedFunction) {
      void submitDirectFunction(next.submittedFunction);
    }
  };
  const handleDevAction = (action: DevAction) => {
    if (sourceTargetSelectionPending() && (action.type === "openFunctionInput" || action.type === "submitFunction")) {
      return;
    }

    if (
      action.type === "openFunctionInput" ||
      action.type === "submitFunction" ||
      action.type === "updateFunctionInputArgument" ||
      action.type === "updateFunctionInputValue" ||
      action.type === "updateFunctionInputGasLimit" ||
      action.type === "clearActiveFunctionInputField" ||
      action.type === "recallFunctionInputHistory" ||
      action.type === "cancelModal"
    ) {
      setFunctionInputError(undefined);
    }
    dispatch(action);
  };
  const recordConfirmedTxPreview = async (event: TxPreviewEvent) => {
    const handler = props.onConfirmedTxPreview;
    if (handler === undefined) {
      return;
    }

    appendExecutionFeed(executionLabel(event, "pending"));
    appendSessionTransaction(transactionFromPreview(event, { status: "ok", message: "pending", transactionStatus: "pending" }));
    try {
      const result = await handler(event);
      if (result !== undefined) {
        appendExecutionResult(event, result);
        appendSessionTransaction(transactionFromPreview(event, result));
        appendEventRecords(result.transaction?.events ?? []);
        appendDeployedContractFromResult(event, result);
        if (result.status === "ok") {
          void refreshAccountStatusQuietly();
          void refreshStateSnapshotQuietly();
          void refreshTransactionsQuietly();
          void refreshDeployedContractsQuietly();
          void refreshEventRecordsQuietly();
          if (result.nextPreview !== undefined) {
            dispatch({ type: "openDeployPreview", event: result.nextPreview });
          }
        }
      }
    } catch (error) {
      const result = { status: "error", message: errorMessage(error) } as const;
      appendExecutionResult(event, result);
      appendSessionTransaction(transactionFromPreview(event, result));
    }
  };
  const appendExecutionResult = (event: TxPreviewEvent, result: ConfirmedTxPreviewResult) => {
    const label = executionLabel(event, result.status === "ok" ? "sent" : "failed");
    appendExecutionFeed(label, result.message);
  };
  const executionLabel = (event: TxPreviewEvent, status: "failed" | "pending" | "sent") => {
    const t = translator();
    const key =
      status === "pending" ? "tui.feed.tx.pending" : status === "sent" ? "tui.feed.tx.sent" : "tui.feed.tx.failed";
    return t(key, { action: event.action, target: event.target.contract });
  };
  const submitFunctionInput = async (draft: DevFunctionInputDraft) => {
    const handler = props.onFunctionInputSubmit;
    const session = currentSession();
    if (handler === undefined || session === undefined) {
      return;
    }

    const preview = await submitFunctionWithInputError(handler, {
      action: draft.action,
      session,
      function: draft.function,
      args: argsFromDraftWithAbiDefaults(draft),
      value: valueFromText(draft.valueText),
      gasLimit: null,
      ...(draft.accountName === undefined ? {} : { accountName: draft.accountName }),
      ...(draft.networkName === undefined ? {} : { networkName: draft.networkName }),
      ...(draft.targetOverride === undefined ? {} : { targetOverride: draft.targetOverride }),
      ...(draft.contractOverride === undefined ? {} : { contractOverride: draft.contractOverride }),
      ...(draft.addressOverride === undefined ? {} : { addressOverride: draft.addressOverride }),
      ...(draft.cwdOverride === undefined ? {} : { cwdOverride: draft.cwdOverride }),
    });
    if (preview === undefined) {
      return;
    }

    if (isTxPreviewEvent(preview)) {
      rememberFunctionInput(draft);
      dispatch({ type: "openDeployPreview", event: preview });
      return;
    }

    if (preview.status === "error") {
      setFunctionInputError(preview.message);
      return;
    }

    rememberFunctionInput(draft);
    appendExecutionFeed(preview.message);
    appendSessionTransaction(transactionFromDraft(session, draft, preview));
    void refreshAccountStatusQuietly();
    void refreshStateSnapshotQuietly();
  };
  const submitDirectFunction = async (submitted: NonNullable<DevState["submittedFunction"]>) => {
    const handler = props.onFunctionInputSubmit;
    const session = currentSession();
    if (handler === undefined || session === undefined) {
      return;
    }

    const result = await submitFunction(handler, {
      action: submitted.action,
      session,
      function: submitted.function,
      args: [],
      value: null,
      gasLimit: null,
      ...(submitted.accountName === undefined ? {} : { accountName: submitted.accountName }),
      ...(submitted.networkName === undefined ? {} : { networkName: submitted.networkName }),
      ...(submitted.targetOverride === undefined ? {} : { targetOverride: submitted.targetOverride }),
      ...(submitted.contractOverride === undefined ? {} : { contractOverride: submitted.contractOverride }),
      ...(submitted.addressOverride === undefined ? {} : { addressOverride: submitted.addressOverride }),
      ...(submitted.cwdOverride === undefined ? {} : { cwdOverride: submitted.cwdOverride }),
    });
    if (result === undefined) {
      return;
    }

    if (isTxPreviewEvent(result)) {
      dispatch({ type: "openDeployPreview", event: result });
      return;
    }

    appendExecutionFeed(result.message);
    appendSessionTransaction(transactionFromSubmitted(session, submitted, result));
    void refreshAccountStatusQuietly();
    void refreshStateSnapshotQuietly();
  };
  const submitFunction = async (
    handler: FunctionInputSubmitHandler,
    input: Parameters<FunctionInputSubmitHandler>[0],
  ) => {
    try {
      return await handler(input);
    } catch (error) {
      appendExecutionFeed(errorMessage(error));
      void refreshStateSnapshotQuietly();
      return undefined;
    }
  };
  const submitFunctionWithInputError = async (
    handler: FunctionInputSubmitHandler,
    input: Parameters<FunctionInputSubmitHandler>[0],
  ) => {
    try {
      return await handler(input);
    } catch (error) {
      setFunctionInputError(errorMessage(error));
      return undefined;
    }
  };
  const recordEntrySelection: DevEntrySelectHandler = async (option) => {
    try {
      const nextSession = await props.onEntrySelect?.(option);
      if (nextSession !== undefined) {
        setCurrentSession(nextSession);
        await refreshSourcePreviews(nextSession);
        await refreshStateSnapshot(nextSession);
        await refreshTransactions(nextSession);
        await refreshDeployedContracts(nextSession);
        await refreshEventRecords(nextSession);
      }
    } catch (error) {
      appendExecutionFeed(errorMessage(error));
    }
  };
  const recordSelectedSourceFile = async (selection: { readonly sourceFile: string; readonly target: string }) => {
    const handler = props.onSourceFileSelect;
    const session = currentSession();
    if (handler === undefined || session === undefined) {
      return;
    }

    setSourceTargetSelectionPending(true);
    try {
      const nextSession = await handler({ ...selection, session });
      if (nextSession !== undefined) {
        setCurrentSession(nextSession);
        await refreshSourcePreviews(nextSession);
        await refreshStateSnapshot(nextSession);
        await refreshTransactions(nextSession);
        await refreshDeployedContracts(nextSession);
        await refreshEventRecords(nextSession);
      }
    } catch (error) {
      appendExecutionFeed(errorMessage(error));
    } finally {
      setSourceTargetSelectionPending(false);
    }
  };
  const recordBuildRequest = async () => {
    const handler = props.onBuildRequest;
    const session = currentSession();
    if (handler === undefined || session === undefined) {
      return;
    }

    appendExecutionFeed(translator()("tui.feed.build.pending", { target: session.contract }));
    try {
      const result = await handler(session);
      if (result !== undefined) {
        setDiagnosticsSnapshot(buildDiagnosticsSnapshot(result));
        appendExecutionFeed(
          translator()(result.status === "ok" ? "tui.feed.build.ok" : "tui.feed.build.failed", { target: session.contract }),
          result.message,
        );
        if (result.status === "ok") {
          void refreshAccountStatusQuietly();
          void refreshStateSnapshotQuietly();
        }
      }
    } catch (error) {
      const message = errorMessage(error);
      setDiagnosticsSnapshot({
        status: "failed",
        message,
        diagnostics: [],
        stdout: null,
        stderr: null,
      });
      appendExecutionFeed(translator()("tui.feed.build.failed", { target: session.contract }), message);
    }
  };
  const recordRefreshRequest = async () => {
    const session = currentSession();
    if (session === undefined) {
      return;
    }

    appendExecutionFeed(translator()("tui.feed.refresh.pending", { target: session.contract }));
    try {
      await refreshSourcePreviews(session);
      await refreshAccountStatus();
      await refreshStateSnapshot(session);
      await refreshDeployedContracts(session);
      await refreshEventRecords(session);
      appendExecutionFeed(translator()("tui.feed.refresh.ok", { target: session.contract }));
    } catch (error) {
      appendExecutionFeed(translator()("tui.feed.refresh.failed", { target: session.contract }), errorMessage(error));
    }
  };
  const appendExecutionFeed = (...lines: readonly string[]) => {
    const stamped = lines.map((line) => `${currentTimeLabel()} ${line}`);
    setExecutionFeedEntries((entries) => [...entries, ...stamped]);
  };
  const refreshStateSnapshot = async (session = currentSession(), deployedContract = activeDeployedContract()) => {
    const handler = props.onStateSnapshotRequest;
    if (handler === undefined || session === undefined) {
      return;
    }

    if (deployedContract === null) {
      setStateSnapshot(noDeployedContractStateSnapshot(translator()("tui.contract.noDeployedSelected")));
      return;
    }

    const nextSnapshot = await handler({ session, deployedContract });
    if (nextSnapshot !== undefined) {
      setStateSnapshot(nextSnapshot);
    }
  };
  const refreshStateSnapshotQuietly = async (session = currentSession(), deployedContract = activeDeployedContract()) => {
    if (stateRefreshInFlight) {
      stateRefreshQueued = true;
      return;
    }

    stateRefreshInFlight = true;
    try {
      await refreshStateSnapshot(session, deployedContract);
    } finally {
      stateRefreshInFlight = false;
      if (stateRefreshQueued) {
        stateRefreshQueued = false;
        void refreshStateSnapshotQuietly();
      }
    }
  };
  const refreshSourcePreviews = async (session = currentSession()) => {
    const handler = props.onSourcePreviewsRequest;
    if (handler === undefined || session === undefined) {
      return;
    }

      const nextPreviews = await handler(session);
    if (nextPreviews !== undefined) {
      setSourcePreviews(nextPreviews);
    }
  };
  const refreshAccountStatus = async (selection = runtimeSelection()) => {
    const handler = props.onAccountStatusRequest;
    if (handler === undefined || selection === undefined) {
      return;
    }

    const nextStatus = await handler(selection);
    if (nextStatus !== undefined) {
      setAccountStatus(nextStatus);
    }
  };
  const refreshAccountStatusQuietly = async (selection = runtimeSelection()) => {
    if (accountStatusRefreshInFlight) {
      return;
    }

    accountStatusRefreshInFlight = true;
    try {
      await refreshAccountStatus(selection);
    } catch (error) {
      setAccountStatus(selection === undefined ? undefined : {
        ...selection,
        address: null,
        signer: null,
        balanceWei: null,
        balanceDisplay: null,
        status: "error",
        message: errorMessage(error),
      });
    } finally {
      accountStatusRefreshInFlight = false;
    }
  };
  const recordRuntimeSelection = (selection: DevRuntimeSelection) => {
    const current = runtimeSelection();
    if (current?.networkName === selection.networkName && current.accountName === selection.accountName) {
      return;
    }

    setRuntimeSelection(selection);
    void refreshAccountStatusQuietly(selection);
    void refreshDeployedContractsQuietly(currentSession());
    void refreshStateSnapshotQuietly(currentSession());
  };
  const recordActiveDeployedContract = (contract: DevDeployedContract | null) => {
    if (sameActiveDeployedContract(activeDeployedContract(), contract)) {
      return;
    }

    setActiveDeployedContract(contract);
    void refreshStateSnapshotQuietly(currentSession(), contract);
  };
  const refreshTransactions = async (session = currentSession()) => {
    const handler = props.onTransactionsRequest;
    if (handler === undefined || session === undefined) {
      return;
    }

    const nextTransactions = await handler(session);
    if (nextTransactions !== undefined) {
      setCachedTransactions(nextTransactions);
    }
  };
  const refreshTransactionsQuietly = async (session = currentSession()) => {
    try {
      await refreshTransactions(session);
    } catch (error) {
      appendExecutionFeed(errorMessage(error));
    }
  };
  const refreshDeployedContracts = async (session = currentSession()) => {
    const handler = props.onDeployedContractsRequest;
    if (handler === undefined || session === undefined) {
      return;
    }

    const selection = runtimeSelection();
    const nextContracts = await handler(
      session,
      selection === undefined ? undefined : { networkName: selection.networkName },
    );
    if (nextContracts !== undefined) {
      setDeployedContracts(nextContracts);
    }
  };
  const refreshDeployedContractsQuietly = async (session = currentSession()) => {
    try {
      await refreshDeployedContracts(session);
    } catch (error) {
      appendExecutionFeed(errorMessage(error));
    }
  };
  const refreshEventRecords = async (session = currentSession()) => {
    const handler = props.onEventRecordsRequest;
    if (handler === undefined || session === undefined) {
      return;
    }

    const nextEvents = await handler(session);
    if (nextEvents !== undefined) {
      setEventRecords(mergeEventRecords(eventRecords(), nextEvents));
    }
  };
  const refreshEventRecordsQuietly = async (session = currentSession()) => {
    try {
      await refreshEventRecords(session);
    } catch (error) {
      appendExecutionFeed(errorMessage(error));
    }
  };
  const recordLocalChainAction = async (request: DevLocalChainActionRequest) => {
    const handler = props.onLocalChainAction;
    if (handler === undefined) {
      return undefined;
    }

    appendExecutionFeed(localChainActionPendingMessage(request));
    try {
      const result = await handler(request);
      if (result !== undefined) {
        appendExecutionFeed(result.message);
      }
      if (request.action === "reset") {
        setSessionTransactions([]);
        setCachedTransactions([]);
        setEventRecords([]);
        setDeployedContracts([]);
        setActiveDeployedContract(null);
        setPreferredActiveDeployedContractId(null);
        setStateSnapshot(noDeployedContractStateSnapshot(translator()("tui.contract.noDeployedSelected")));
      }
      const session = currentSession();
      void refreshAccountStatusQuietly();
      void refreshStateSnapshotQuietly(session);
      void refreshTransactionsQuietly(session);
      void refreshDeployedContractsQuietly(session);
      void refreshEventRecordsQuietly(session);
      return result;
    } catch (error) {
      appendExecutionFeed(errorMessage(error));
      throw error;
    }
  };
  const appendSessionTransaction = (record: DevTransactionRecord) => {
    setSessionTransactions((records) => [
      record,
      ...records.filter((item) => !sameTransactionLifecycle(item, record)),
    ].slice(0, 100));
  };
  const appendDeployedContractFromResult = (event: TxPreviewEvent, result: ConfirmedTxPreviewResult) => {
    const session = currentSession();
    if (event.action !== "deploy" || result.status !== "ok" || session === undefined) {
      return;
    }

    const contract = deployedContractFromResult(session, event, result);
    if (contract === null) {
      return;
    }
    setPreferredActiveDeployedContractId(contract.id);
    setDeployedContracts((contracts) => mergeDeployedContracts(contracts, [contract]));
  };
  const appendEventRecords = (records: readonly DevContractEventRecord[]) => {
    if (records.length === 0) {
      return;
    }
    setEventRecords((current) => mergeEventRecords(current, records));
  };
  const removeDeployedContract = (id: string) => {
    setDeployedContracts((contracts) => contracts.filter((contract) => contract.id !== id));
  };
  const addExternalDeployedContract = (address: string): string | void => {
    const session = currentSession();
    const selection = runtimeSelection();
    if (session === undefined || selection === undefined) {
      return undefined;
    }

    const id = `external:${selection.networkName}:${session.contract}:${address.toLowerCase()}:${Date.now()}`;
    const contract: DevDeployedContract = {
      id,
      contract: session.contract,
      address,
      target: session.target,
      ...(session.workspaceRoot === undefined ? {} : { workspaceRoot: session.workspaceRoot }),
      sourceFile: session.sourceFile,
      network: selection.networkName,
      chainId: null,
      account: selection.accountName,
      deployTxHash: null,
      status: "external",
      constructorArgs: [],
      value: null,
      abiSummary: session.abiSummary,
      constructor: session.constructor,
      functions: session.functions,
      createdAtUnix: Math.floor(Date.now() / 1000),
    };
    setDeployedContracts((contracts) => mergeDeployedContracts(contracts, [contract]));
    setPreferredActiveDeployedContractId(contract.id);
    return id;
  };
  const copySelection = (text: string) => {
    if (props.copySelectedText !== undefined) {
      props.copySelectedText(text);
      return;
    }

    renderer.copyToClipboardOSC52(text);
    props.copyToSystemClipboard?.(text);
  };
  const recordSettingsChange: DevSettingsChangeHandler = async (change) => {
    const current = settings();
    const result = await props.onSettingsChange?.(change);
    const language = change.language ?? current?.language ?? currentLocale();
    const showRawStateValues = change.showRawStateValues ?? current?.showRawStateValues ?? true;
    const hideNoArgReadActions = change.hideNoArgReadActions ?? current?.hideNoArgReadActions ?? false;
    const next = result ?? {
      language,
      resolvedLocale: language === "system" ? current?.systemLocale ?? currentLocale() : language,
      showRawStateValues,
      hideNoArgReadActions,
      ...(current?.configPath === undefined ? {} : { configPath: current.configPath }),
    };
    setCurrentLocale(next.resolvedLocale);
    const configPath = next.configPath ?? current?.configPath;
    setSettings({
      language: next.language,
      resolvedLocale: next.resolvedLocale,
      systemLocale: current?.systemLocale ?? currentLocale(),
      showRawStateValues: next.showRawStateValues,
      hideNoArgReadActions: next.hideNoArgReadActions,
      ...(configPath === undefined ? {} : { configPath }),
    });
    return next;
  };
  const recordStateKeyBookChange = async (
    change: DevStateKeyBookChange,
    context?: Parameters<DevStateKeyBookChangeHandler>[1],
  ) => {
    if (props.onStateKeyBookChange === undefined) {
      return;
    }

    try {
      const session = currentSession();
      await props.onStateKeyBookChange(change, {
        ...(session === undefined ? {} : { session }),
        ...(context?.networkName === undefined ? {} : { networkName: context.networkName }),
      });
      appendExecutionFeed(translator()("tui.state.keyBook.saved"));
      await refreshStateSnapshotQuietly();
    } catch (error) {
      appendExecutionFeed(translator()("tui.feed.refresh.failed", { target: change.action === "add_key" ? change.contract : "state" }), errorMessage(error));
    }
  };
  const withFunctionInputHistory = (action: DevAction): DevAction => {
    if (action.type !== "openFunctionInput") {
      return action;
    }

    return {
      ...action,
      history: functionInputHistory().get(functionInputHistoryKey(action.action ?? "send", action.function.signature)) ?? [],
    };
  };
  const rememberFunctionInput = (draft: DevFunctionInputDraft) => {
    const values = {
      argumentTexts: draft.argumentTexts.map((value) => value.trim()),
      valueText: draft.valueText.trim(),
      gasLimitText: draft.gasLimitText.trim(),
      gasLimitMode: draft.gasLimitMode,
    };
    if (values.argumentTexts.length === 0 && values.valueText.length === 0 && values.gasLimitText.length === 0 && values.gasLimitMode === "auto") {
      return;
    }

    const key = functionInputHistoryKey(draft.action, draft.function.signature);
    setFunctionInputHistory((history) => {
      const next = new Map(history);
      const current = next.get(key) ?? [];
      const deduped = current.filter((entry) => !sameFunctionInputValues(entry, values));
      next.set(key, [...deduped, values].slice(-20));
      return next;
    });
  };

  useSelectionHandler((selection: Selection) => {
    if (!selection.isActive || selection.isDragging) {
      return;
    }

    const text = selection.getSelectedText();
    if (text.trim().length === 0 || text === lastCopiedSelection) {
      return;
    }

    lastCopiedSelection = text;
    copySelection(text);
  });

  createEffect(() => {
    const session = currentSession();
    if (props.onStateSnapshotRequest === undefined || session === undefined) {
      return;
    }

    const timer = setInterval(() => {
      void refreshStateSnapshotQuietly(session);
    }, 5000);
    onCleanup(() => {
      clearInterval(timer);
    });
  });

  createEffect(() => {
    const selection = runtimeSelection();
    if (selection === undefined || props.onAccountStatusRequest === undefined) {
      return;
    }

    const timer = setInterval(() => {
      void refreshAccountStatusQuietly(selection);
    }, 5000);
    onCleanup(() => {
      clearInterval(timer);
    });
  });

  createEffect(() => {
    const session = currentSession();
    const selection = runtimeSelection();
    const handler = props.onBlockWatchStart;
    if (session === undefined || selection === undefined || handler === undefined) {
      return;
    }

    const stop = handler(
      { session, selection },
      {
        onBlockNumber: () => {
          void refreshAccountStatusQuietly(selection);
          void refreshStateSnapshotQuietly(session);
          void refreshTransactionsQuietly(session);
          void refreshDeployedContractsQuietly(session);
        },
        onEvents: (records) => {
          setEventRecords((current) => mergeEventRecords(current, records));
        },
      },
    );
    onCleanup(() => {
      stop?.();
    });
  });

  return (
    <DevShell
      locale={currentLocale()}
      session={currentSession()}
      {...(props.networkOptions === undefined ? {} : { networkOptions: props.networkOptions })}
      {...(props.accountOptions === undefined ? {} : { accountOptions: props.accountOptions })}
      {...(props.entryOptions === undefined ? {} : { entryOptions: props.entryOptions })}
      {...(props.entrySelectorType === undefined ? {} : { entrySelectorType: props.entrySelectorType })}
      {...sourcePreviewsProps(sourcePreviews())}
      {...accountStatusProps(accountStatus())}
      {...stateSnapshotProps(stateSnapshot())}
      transactions={transactionRecords()}
      deployedContracts={deployedContracts()}
      preferredActiveDeployedContractId={preferredActiveDeployedContractId()}
      eventRecords={eventRecords()}
      traceText={traceText()}
      onRequestTrace={requestTrace}
      onCloseTrace={closeTrace}
      {...settingsProps(settings())}
      diagnosticsSnapshot={diagnosticsSnapshot()}
      {...feedEntryProps(feedEntries())}
      modal={activeModal()}
      {...functionInputErrorProps(functionInputError())}
      sourceTargetSelectionPending={sourceTargetSelectionPending()}
      onDevAction={handleDevAction}
      onEntrySelect={(option) => {
        void recordEntrySelection(option);
      }}
      onSubmitFunctionInput={(draft) => {
        void submitFunctionInput(draft);
      }}
      onBuildRequest={() => {
        void recordBuildRequest();
      }}
      onRefreshRequest={() => {
        void recordRefreshRequest();
      }}
      onRuntimeSelectionChange={recordRuntimeSelection}
      onActiveDeployedContractChange={recordActiveDeployedContract}
      onDeployedContractAdd={addExternalDeployedContract}
      onDeployedContractRemove={removeDeployedContract}
      {...(props.onChainStatesRequest === undefined ? {} : { onChainStatesRequest: props.onChainStatesRequest })}
      {...(props.onLocalChainAction === undefined ? {} : { onLocalChainAction: recordLocalChainAction })}
      onCopyText={copySelection}
      onSettingsChange={recordSettingsChange}
      {...(props.onStateDetailRequest === undefined ? {} : { onStateDetailRequest: props.onStateDetailRequest })}
      onStateKeyBookChange={(change, context) => recordStateKeyBookChange(change, context)}
      onExitRequest={() => {
        props.onExitRequest?.();
        renderer.destroy();
      }}
    />
  );
}

