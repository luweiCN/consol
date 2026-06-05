/** @jsxImportSource @opentui/solid */
import {
  createInitialDevState,
  devReducer,
  type DevAction,
  type DevFunctionInputDraft,
  type DevFunctionInputValues,
  type DevSession,
  type DevState,
} from "@consol/core";
import { createTranslator } from "@consol/i18n";
import type { ConsolEvent, TxPreviewEvent } from "@consol/protocol";
import type { Selection } from "@opentui/core";
import { useRenderer, useSelectionHandler } from "@opentui/solid";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { DevShell, type DevShellProps } from "./DevShell";
import type {
  ConfirmedTxPreviewHandler,
  ConfirmedTxPreviewResult,
  DevBlockWatchHandler,
  BuildRequestHandler,
  BuildRequestResult,
  DevAccountStatusHandler,
  DevAccountStatusSnapshot,
  DevEntrySelectHandler,
  DevBuildDiagnosticsSnapshot,
  DevContractEventRecord,
  DevDeployedContract,
  DevDeployedContractsHandler,
  DevEventRecordsHandler,
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

export type DevShellControllerProps = Omit<
  DevShellProps,
  "modal" | "onActiveDeployedContractChange" | "onBuildRequest" | "onCancelModal" | "onConfirmTxPreview" | "onDeployedContractAdd" | "onDeployedContractRemove" | "onDevAction" | "onEntrySelect" | "onRefreshRequest" | "onRuntimeSelectionChange" | "onSubmitFunctionInput"
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
  readonly onEventRecordsRequest?: DevEventRecordsHandler;
  readonly onSourcePreviewsRequest?: SourcePreviewsHandler;
  readonly onBuildRequest?: BuildRequestHandler;
  readonly onAccountStatusRequest?: DevAccountStatusHandler;
  readonly onBlockWatchStart?: DevBlockWatchHandler;
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
  const [activeDeployedContract, setActiveDeployedContract] = createSignal<DevDeployedContract | null>(null);
  const [preferredActiveDeployedContractId, setPreferredActiveDeployedContractId] = createSignal<string | null>(null);
  const [eventRecords, setEventRecords] = createSignal<readonly DevContractEventRecord[]>(props.eventRecords ?? []);
  const [settings, setSettings] = createSignal<DevSettingsSnapshot | undefined>(props.settings);
  const [diagnosticsSnapshot, setDiagnosticsSnapshot] = createSignal<DevBuildDiagnosticsSnapshot | undefined>(props.diagnosticsSnapshot);
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
      args: argsFromDraft(draft),
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

    const nextContracts = await handler(session);
    if (nextContracts !== undefined) {
      setDeployedContracts(mergeDeployedContracts(deployedContracts(), nextContracts));
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
  const recordStateKeyBookChange = async (change: DevStateKeyBookChange) => {
    if (props.onStateKeyBookChange === undefined) {
      return;
    }

    try {
      await props.onStateKeyBookChange(change);
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

    const stop = handler({ session, selection }, () => {
      void refreshAccountStatusQuietly(selection);
      void refreshStateSnapshotQuietly(session);
      void refreshTransactionsQuietly(session);
      void refreshDeployedContractsQuietly(session);
      void refreshEventRecordsQuietly(session);
    });
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
      {...settingsProps(settings())}
      diagnosticsSnapshot={diagnosticsSnapshot()}
      {...feedEntryProps(feedEntries())}
      modal={activeModal()}
      {...functionInputErrorProps(functionInputError())}
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
      onCopyText={copySelection}
      onSettingsChange={recordSettingsChange}
      {...(props.onStateDetailRequest === undefined ? {} : { onStateDetailRequest: props.onStateDetailRequest })}
      onStateKeyBookChange={(change) => {
        void recordStateKeyBookChange(change);
      }}
      onExitRequest={() => {
        props.onExitRequest?.();
        renderer.destroy();
      }}
    />
  );
}

function settingsProps(settings: DevSettingsSnapshot | undefined): { readonly settings?: DevSettingsSnapshot } {
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

function timestampedFeedEventLine(event: ConsolEvent, t: ReturnType<typeof createTranslator>): string {
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

function currentTimeLabel(): string {
  return timeLabel(new Date());
}

function timeLabel(date: Date): string {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `[${hours}:${minutes}:${seconds}]`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function feedEntryProps(entries: readonly string[] | undefined) {
  return entries === undefined ? {} : { feedEntries: entries };
}

function functionInputErrorProps(error: string | undefined) {
  return error === undefined ? {} : { functionInputError: error };
}

function stateSnapshotProps(snapshot: DevStateSnapshot | undefined) {
  return snapshot === undefined ? {} : { stateSnapshot: snapshot };
}

function sourcePreviewsProps(previews: readonly SourcePreview[] | undefined) {
  return previews === undefined ? {} : { sourcePreviews: previews };
}

function accountStatusProps(status: DevAccountStatusSnapshot | undefined) {
  return status === undefined ? {} : { accountStatus: status };
}

function noDeployedContractStateSnapshot(message: string): DevStateSnapshot {
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

function sameActiveDeployedContract(left: DevDeployedContract | null, right: DevDeployedContract | null): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null) {
    return false;
  }
  return left.id === right.id && left.address.toLowerCase() === right.address.toLowerCase();
}

function mergeTransactionRecords(
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

function mergeDeployedContracts(
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
  const chainId = contract.chainId ?? chainIdFromFingerprint(contract.networkFingerprint);
  return chainId === null ? contract.networkFingerprint ?? contract.network ?? "-" : `chain:${chainId}`;
}

function chainIdFromFingerprint(fingerprint: string | null | undefined): string | null {
  const match = fingerprint?.match(/^[^:]+:(\d+):/);
  return match?.[1] ?? null;
}

function mergeEventRecords(
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

function sameTransactionLifecycle(left: DevTransactionRecord, right: DevTransactionRecord): boolean {
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

function initialRuntimeSelection(status: DevAccountStatusSnapshot | undefined): DevRuntimeSelection | undefined {
  return status === undefined ? undefined : { networkName: status.networkName, accountName: status.accountName };
}

function transactionFromPreview(
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

function deployedContractFromResult(
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

function transactionFromDraft(
  session: DevSession,
  draft: DevFunctionInputDraft,
  result: ConfirmedTxPreviewResult,
): DevTransactionRecord {
  return transactionFromFunctionResult({
    session,
    action: draft.action,
    functionName: draft.function.name,
    signature: draft.function.signature,
    args: argsFromDraft(draft),
    result,
    ...(draft.accountName === undefined ? {} : { accountName: draft.accountName }),
    ...(draft.networkName === undefined ? {} : { networkName: draft.networkName }),
    ...(draft.targetOverride === undefined ? {} : { targetOverride: draft.targetOverride }),
    ...(draft.contractOverride === undefined ? {} : { contractOverride: draft.contractOverride }),
    ...(draft.addressOverride === undefined ? {} : { addressOverride: draft.addressOverride }),
  });
}

function transactionFromSubmitted(
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

function buildDiagnosticsSnapshot(result: BuildRequestResult): DevBuildDiagnosticsSnapshot {
  return {
    status: result.status === "ok" ? "success" : "failed",
    message: result.message,
    diagnostics: result.diagnostics ?? [],
    stdout: result.stdout ?? null,
    stderr: result.stderr ?? null,
  };
}

function argsFromDraft(draft: DevFunctionInputDraft): readonly string[] {
  return draft.argumentTexts.map((value) => value.trim());
}

function valueFromText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isTxPreviewEvent(value: TxPreviewEvent | ConfirmedTxPreviewResult): value is TxPreviewEvent {
  return "type" in value && value.type === "tx.preview";
}

function functionInputHistoryKey(action: DevFunctionInputDraft["action"], signature: string): string {
  return `${action}:${signature}`;
}

function sameFunctionInputValues(left: DevFunctionInputValues, right: DevFunctionInputValues): boolean {
  return left.valueText === right.valueText
    && left.gasLimitText === right.gasLimitText
    && left.gasLimitMode === right.gasLimitMode
    && left.argumentTexts.join("\u0000") === right.argumentTexts.join("\u0000");
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
