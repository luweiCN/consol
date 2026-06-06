/** @jsxImportSource @opentui/solid */
import type { DevAction, DevFunctionInputDraft, DevModal, DevPanel, DevSession } from "@consol/core";
import { createTranslator, type Locale, type MessageKey } from "@consol/i18n";
import type { MouseEvent, TabSelectRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, onCleanup, Show, type Accessor, type JSX } from "solid-js";
import { ExitConfirmModal } from "./ExitConfirmModal";
import { FunctionInputModalBridge } from "./FunctionInputModalBridge";
import { ContractDetails, DiagnosticsDetails, EventsDetails, FeedScroll, PanelBox, StateDetails, transactionDetailText, TransactionDetailModal, TransactionsDetails } from "./DevPanels";
import {
  DevSelectorLayer,
  type DevAccountOption,
  type DevNetworkOption,
  type EntrySelectorType,
  type SelectorKind,
} from "./DevSelectorLayer";
import { selectedFunctionInputAction } from "./dev-actions";
import { visibleContractActionFunctions } from "./dev-function-model";
import { isEnterKey, isTxPreviewConfirmKey, isTxPreviewGasModeLeftKey, isTxPreviewGasModeRightKey } from "./dev-keymap";
import { createDevSelectorActions } from "./dev-selector-actions";
import { createDevShellSelectorState } from "./dev-shell-selector-state";
import { initialSourceTargetIndex } from "./dev-source-targets";
import { StatusBar } from "./DevStatusBar";
import { contractPanelTitle, displaySourceFile } from "./DevShellLabels";
import { centeredModalRect } from "./modal-layout";
import type { PickerActionOption } from "./PickerActionMenu";
import type { SelectorOption } from "./SelectorModal";
import { ShortcutBar, ShortcutOverlay } from "./ShortcutHelp";
import {
  StateKeyBookListModal,
  StateKeyBookModal,
  type StateKeyBookAction,
  type StateKeyBookField,
} from "./StateKeyBookModal";
import { stateDetailText, StateDetailModal, stateStorageRowDetailLines, stateValueDetailLines, type StateDetailLine } from "./StateRows";
import { theme } from "./theme";
import { TxPreviewModalLayer } from "./TxPreviewModal";
import type {
  DevAccountStatusSnapshot,
  DevBuildDiagnosticsSnapshot,
  DevContractEventRecord,
  DevDeployedContract,
  DevRuntimeSelection,
  DevSettingsChangeHandler,
  DevSettingsSnapshot,
  DevStateKeyBookChange,
  DevStateKeyBookChangeHandler,
  DevStateKeyBookDetailEntry,
  DevStateRowDetailHandler,
  DevStateRowDetailSnapshot,
  DevStateSnapshot,
  DevStateValueSnapshot,
  DevStorageStateRowSnapshot,
  DevTransactionRecord,
  SourcePreview,
} from "./runtime-types";

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
  readonly settings?: DevSettingsSnapshot;
  readonly feedEntries?: readonly string[];
  readonly functionInputError?: string;
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
  readonly onCopyText?: (text: string) => void;
  readonly onSettingsChange?: DevSettingsChangeHandler;
  readonly onStateKeyBookChange?: DevStateKeyBookChangeHandler;
  readonly onStateDetailRequest?: DevStateRowDetailHandler;
  readonly onExitRequest?: () => void;
};

type TxPreviewEvent = Extract<DevModal, { readonly type: "txPreview" }>["event"];
type StateSelectableRow =
  | {
    readonly id: string;
    readonly kind: "value";
    readonly value: DevStateValueSnapshot;
  }
  | {
    readonly id: string;
    readonly kind: "storage";
    readonly row: DevStorageStateRowSnapshot;
  };
type StateKeyBookDraft = {
  readonly mode: "add" | "edit";
  readonly layoutId: string;
  readonly target: string;
  readonly contract: string;
  readonly keyType: string;
  readonly keyText: string;
  readonly labelText: string;
  readonly activeField: StateKeyBookField;
  readonly error?: string;
};

const basePanels: readonly DevPanel[] = ["contract", "state", "feed"];
const topTabs = ["dev", "transactions", "events", "diagnostics", "settings"] as const;
type DevTopTab = (typeof topTabs)[number];
type LocalePreference = DevSettingsSnapshot["language"];

const panelKeys = {
  files: "tui.panel.files",
  contract: "tui.panel.contract",
  state: "tui.panel.state",
  feed: "tui.panel.feed",
  diagnostics: "tui.panel.diagnostics",
} as const satisfies Record<DevPanel, MessageKey>;

const topTabKeys = {
  dev: "tui.tab.dev",
  transactions: "tui.tab.transactions",
  diagnostics: "tui.tab.diagnostics",
  events: "tui.tab.events",
  settings: "tui.tab.settings",
} as const satisfies Record<DevTopTab, MessageKey>;

const topTabDescriptionKeys = {
  dev: "tui.tab.dev.description",
  transactions: "tui.tab.transactions.description",
  diagnostics: "tui.tab.diagnostics.description",
  events: "tui.tab.events.description",
  settings: "tui.tab.settings.description",
} as const satisfies Record<DevTopTab, MessageKey>;

const languagePreferences = ["system", "zh-CN", "en-US"] as const satisfies readonly LocalePreference[];
const settingsSections = ["language", "stateDisplay", "contractActions"] as const;
type SettingsSection = (typeof settingsSections)[number];

export type { DevAccountOption, DevNetworkOption };

export function DevShell(props: DevShellProps) {
  const dimensions = useTerminalDimensions();
  const translator = createMemo(() => createTranslator(props.locale));
  const [activeTopTab, setActiveTopTab] = createSignal<DevTopTab>("dev");
  const [focusedPanel, setFocusedPanel] = createSignal<DevPanel>("contract");
  const [selectedFunctionIndex, setSelectedFunctionIndex] = createSignal(0);
  const [selectedSourceTargetIndex, setSelectedSourceTargetIndex] = createSignal(initialSourceTargetIndex(props.session));
  const [selectedTransactionIndex, setSelectedTransactionIndex] = createSignal(0);
  const [selectedEventIndex, setSelectedEventIndex] = createSignal(0);
  const [transactionDetailIndex, setTransactionDetailIndex] = createSignal<number | null>(null);
  const [activeDeployedContractId, setActiveDeployedContractId] = createSignal<string | null>(props.deployedContracts?.[0]?.id ?? null);
  const [settingsMessage, setSettingsMessage] = createSignal("");
  const [selectedSettingsIndex, setSelectedSettingsIndex] = createSignal(0);
  const [draftLanguage, setDraftLanguage] = createSignal<LocalePreference>(props.settings?.language ?? "system");
  const [draftShowRawStateValues, setDraftShowRawStateValues] = createSignal(props.settings?.showRawStateValues ?? true);
  const [draftHideNoArgReadActions, setDraftHideNoArgReadActions] = createSignal(props.settings?.hideNoArgReadActions ?? false);
  const [localStateRawVisible, setLocalStateRawVisible] = createSignal<boolean | null>(null);
  const [selectedStateRowId, setSelectedStateRowId] = createSignal<string | null>(null);
  const [stateDetailRowId, setStateDetailRowId] = createSignal<string | null>(null);
  const [stateDetailSnapshot, setStateDetailSnapshot] = createSignal<DevStateRowDetailSnapshot | null>(null);
  const [stateKeyBookDraft, setStateKeyBookDraft] = createSignal<StateKeyBookDraft | null>(null);
  const [stateKeyBookVisible, setStateKeyBookVisible] = createSignal(false);
  const [stateKeyBookQuery, setStateKeyBookQuery] = createSignal("");
  const [stateKeyBookSelectedIndex, setStateKeyBookSelectedIndex] = createSignal(0);
  const [stateKeyBookActionIndex, setStateKeyBookActionIndex] = createSignal<number | null>(null);
  const [feedScroll, setFeedScroll] = createSignal(0);
  const [shortcutsVisible, setShortcutsVisible] = createSignal(false);
  const [exitConfirmVisible, setExitConfirmVisible] = createSignal(false);
  const [nowUnix, setNowUnix] = createSignal(currentUnix());
  let syncedSessionKey = "";
  const selectors = createDevShellSelectorState({
    session: () => props.session,
    networkOptions: () => props.networkOptions,
    accountOptions: () => props.accountOptions,
    accountStatus: () => props.accountStatus,
    entryOptions: () => props.entryOptions,
    sourcePreviews: () => props.sourcePreviews,
    deployedContracts: () => props.deployedContracts ?? [],
    nowUnix,
    locale: () => props.locale,
    activeDeployedContractId,
    setActiveDeployedContractId,
    selectedSourceTargetIndex,
    setSelectedSourceTargetIndex,
    onDevAction: (action) => props.onDevAction?.(action),
    onEntrySelect: (option) => props.onEntrySelect?.(option),
  });

  createEffect(() => {
    if (selectors.activeSelector().kind !== "deployed") {
      return;
    }

    setNowUnix(currentUnix());
    const timer = setInterval(() => {
      setNowUnix(currentUnix());
    }, 1_000);
    onCleanup(() => {
      clearInterval(timer);
    });
  });

  const t = (key: MessageKey, values?: Record<string, string | number>) => translator()(key, values);
  const selectorActionMenu = createDevSelectorActions({
    activeSelector: selectors.activeSelector,
    filteredOptions: selectors.filteredSelectorOptions,
    activeDeployedContractId,
    setActiveDeployedContractId,
    translate: t,
    selectOption: selectors.selectOption,
    closeSelector: selectors.closeSelector,
    updateSelectorQuery: selectors.updateSelectorQuery,
    onCopyText: (text) => props.onCopyText?.(text),
    onDeployedContractAdd: (address) => props.onDeployedContractAdd?.(address),
    onDeployedContractRemove: (id) => props.onDeployedContractRemove?.(id),
  });
  const panelTitle = (panel: DevPanel) => t(panelKeys[panel]);
  const isWide = () => dimensions().width >= 70;
  const useTallStatusBar = () => dimensions().height >= 24;
  const visiblePanels = (): readonly DevPanel[] => basePanels;
  const hasSelectorPreview = () => dimensions().width >= 100;
  const selectorRect = () => {
    const rect = centeredModalRect({
      viewportWidth: dimensions().width,
      viewportHeight: dimensions().height,
      widthRatio: hasSelectorPreview() ? 0.9 : 0.78,
      heightRatio: isWide() ? 0.76 : 0.68,
      minWidth: isWide() ? 70 : 36,
      minHeight: isWide() ? 18 : 12,
      maxWidth: 118,
    });
    const top = Math.max(dimensions().height >= 24 ? 8 : 1, rect.top);
    const maxHeight = Math.max(6, dimensions().height - top - (dimensions().height >= 24 ? 3 : 1));
    return { ...rect, top, height: Math.min(rect.height, maxHeight) };
  };
  const actionModalRect = () => centeredModalRect({
    viewportWidth: dimensions().width,
    viewportHeight: dimensions().height,
    widthRatio: isWide() ? 0.94 : 0.94,
    heightRatio: isWide() ? 0.72 : 0.64,
    minWidth: isWide() ? 68 : 36,
    minHeight: isWide() ? 18 : 12,
    maxWidth: 112,
    maxHeight: 28,
  });
  const stateKeyBookModalRect = () => centeredModalRect({
    viewportWidth: dimensions().width,
    viewportHeight: dimensions().height,
    widthRatio: isWide() ? 0.58 : 0.9,
    heightRatio: isWide() ? 0.58 : 0.6,
    minWidth: isWide() ? 52 : 34,
    minHeight: 12,
    maxWidth: 76,
    maxHeight: 20,
  });
  const shortcutRect = () => centeredModalRect({
    viewportWidth: dimensions().width,
    viewportHeight: dimensions().height,
    widthRatio: isWide() ? 0.54 : 0.92,
    heightRatio: isWide() ? 0.44 : 0.48,
    minWidth: isWide() ? 52 : 34,
    minHeight: 12,
    maxWidth: 72,
    maxHeight: 16,
  });
  const focusPanel = (panel: DevPanel) => { setFocusedPanel(panel); };
  const nextPanel = (direction: 1 | -1) => {
    const panels = visiblePanels();
    const index = panels.indexOf(focusedPanel());
    const nextIndex = (index + direction + panels.length) % panels.length;
    focusPanel(panels[nextIndex] ?? "contract");
  };
  const nextTopTab = (direction: 1 | -1) => {
    const index = topTabs.indexOf(activeTopTab());
    setActiveTopTab(topTabs[(index + direction + topTabs.length) % topTabs.length] ?? "dev");
  };
  const contractPanelContentWidth = () => Math.max(20, isWide() ? Math.floor(dimensions().width / 2) - 4 : dimensions().width - 4);
  const moveSelectedTransaction = (direction: 1 | -1) => {
    const count = props.transactions?.length ?? 0;
    if (count === 0) {
      return;
    }

    setSelectedTransactionIndex((index) => (index + direction + count) % count);
  };
  const openSelectedTransaction = () => {
    const count = props.transactions?.length ?? 0;
    if (count === 0) {
      return;
    }

    setTransactionDetailIndex(selectedTransactionIndex());
  };
  const moveSelectedFunction = (direction: 1 | -1) => {
    const count = activeFunctionList().length;
    if (count === 0) {
      return;
    }

    setSelectedFunctionIndex((index) => (index + direction + count) % count);
  };
  const moveSelectedSourceTarget = (direction: 1 | -1) => {
    const session = props.session;
    const sourceFile = displaySourceFile(session);
    if (session === undefined || sourceFile === null) {
      return;
    }

    const targets = session.sourceTargets
      .map((target, index) => ({ ...target, index }))
      .filter((target) => target.sourceFile === sourceFile && target.deployable !== false);
    if (targets.length <= 1) {
      return;
    }

    const currentIndex = targets.findIndex((target) =>
      target.index === selectedSourceTargetIndex() || target.contract === session.contract,
    );
    const next = targets[(currentIndex + direction + targets.length) % targets.length] ?? targets[0];
    if (next !== undefined) {
      selectSourceTarget(next.index);
      setSelectedFunctionIndex(0);
    }
  };
  const runtimeSelection = () => ({
    accountName: selectors.activeAccount()?.name ?? "anvil0",
    networkName: selectors.activeNetwork().name,
  });
  const activeDeployedContract = () =>
    (props.deployedContracts ?? []).find((contract) => contract.id === activeDeployedContractId()) ?? null;
  const activeFunctionList = () => visibleContractActionFunctions(activeDeployedContract()?.functions ?? [], { hideNoArgReadActions: settingsSnapshot().hideNoArgReadActions });
  const stateRows = (): readonly StateSelectableRow[] => {
    const snapshot = props.stateSnapshot;
    if (snapshot === undefined) {
      return [];
    }

    return [
      ...snapshot.values.map((value) => ({ id: stateValueRowId(value), kind: "value" as const, value })),
      ...(snapshot.storageValues ?? []).map((row) => ({ id: row.id, kind: "storage" as const, row })),
    ];
  };
  const selectedStateRowIndex = () => {
    const id = selectedStateRowId();
    if (id === null) {
      return -1;
    }

    return stateRows().findIndex((row) => row.id === id);
  };
  const selectedStateRow = () => {
    const index = selectedStateRowIndex();
    return index < 0 ? undefined : stateRows()[index];
  };
  const stateDetailRow = () => {
    const id = stateDetailRowId();
    return id === null ? undefined : stateRows().find((row) => row.id === id);
  };
  let appliedPreferredDeployedContractId: string | null = null;

  createEffect(() => {
    const session = props.session;
    const sessionKey =
      session === undefined
        ? "none"
        : `${session.projectRoot}\u0000${session.target}\u0000${session.contract}\u0000${session.sourceTargets.length}`;
    if (sessionKey === syncedSessionKey) {
      return;
    }

    syncedSessionKey = sessionKey;
    setSelectedSourceTargetIndex(initialSourceTargetIndex(session));
    setSelectedFunctionIndex(0);
  });

  createEffect(() => {
    const contracts = props.deployedContracts ?? [];
    const preferred = props.preferredActiveDeployedContractId ?? null;
    if (
      preferred !== null &&
      preferred !== appliedPreferredDeployedContractId &&
      contracts.some((contract) => contract.id === preferred)
    ) {
      appliedPreferredDeployedContractId = preferred;
      setActiveDeployedContractId(preferred);
      return;
    }
    if (contracts.length === 0) {
      setActiveDeployedContractId(null);
      return;
    }
    if (contracts.some((contract) => contract.id === activeDeployedContractId())) {
      return;
    }
    setActiveDeployedContractId(contracts[0]?.id ?? null);
  });

  createEffect(() => {
    props.onRuntimeSelectionChange?.(runtimeSelection());
  });
  createEffect(() => {
    props.onActiveDeployedContractChange?.(activeDeployedContract());
  });
  createEffect(() => {
    const snapshot = settingsSnapshot();
    setDraftLanguage(snapshot.language);
    setDraftShowRawStateValues(snapshot.showRawStateValues);
    setDraftHideNoArgReadActions(snapshot.hideNoArgReadActions);
  });
  createEffect(() => {
    const count = activeFunctionList().length;
    if (count === 0) {
      setSelectedFunctionIndex(0);
      return;
    }
    if (selectedFunctionIndex() >= count) {
      setSelectedFunctionIndex(count - 1);
    }
  });
  createEffect(() => {
    const rows = stateRows();
    const currentId = selectedStateRowId();
    if (rows.length === 0) {
      return;
    }

    if (currentId === null || !rows.some((row) => row.id === currentId)) {
      setSelectedStateRowId(rows[0]?.id ?? null);
    }
    const detailId = stateDetailRowId();
    if (detailId !== null && !rows.some((row) => row.id === detailId)) {
      setStateDetailRowId(null);
      setStateDetailSnapshot(null);
      setStateKeyBookVisible(false);
      setStateKeyBookActionIndex(null);
    }
  });
  const openFunctionInputAtIndex = (index: number) => {
    const instance = activeDeployedContract();
    const action = selectedFunctionInputAction({
      session: props.session,
      deploySelected: false,
      selectedFunctionIndex: index,
      functions: activeFunctionList(),
      ...(instance === null ? {} : {
        targetOverride: instance.target,
        contractOverride: instance.contract,
        addressOverride: instance.address,
        ...(instance.workspaceRoot === undefined ? {} : { cwdOverride: instance.workspaceRoot }),
      }),
      ...runtimeSelection(),
    });
    if (action !== null) props.onDevAction?.(action);
  };
  const openSelectedFunctionInput = () => {
    openFunctionInputAtIndex(selectedFunctionIndex());
  };
  const openDeployInput = (deployAction: "deploy" | "redeploy") => {
    const action = selectedFunctionInputAction({
      session: props.session,
      deploySelected: true,
      deployAction,
      selectedFunctionIndex: selectedFunctionIndex(),
      ...runtimeSelection(),
    });
    if (action !== null) props.onDevAction?.(action);
  };
  const openSelector = (kind: SelectorKind) => {
    selectorActionMenu.reset();
    selectors.openSelector(kind);
  };
  const openFileSelector = () => {
    const hasEntryOptions = props.session === undefined && (props.entryOptions?.length ?? 0) > 0;
    openSelector(hasEntryOptions ? "entry" : "source");
  };
  const selectSourceTarget = (index: number) => {
    const sourceTarget = props.session?.sourceTargets[index];
    if (sourceTarget === undefined) {
      return;
    }

    setSelectedSourceTargetIndex(index);
    props.onDevAction?.({ type: "selectSourceTarget", sourceFile: sourceTarget.sourceFile, target: sourceTarget.target });
  };
  const cancelModal = () => {
    props.onCancelModal?.();
    props.onDevAction?.({ type: "cancelModal" });
  };
  const confirmTxPreview = (event: TxPreviewEvent) => {
    props.onConfirmTxPreview?.(event);
    props.onDevAction?.({ type: "confirmTxPreview", previewId: event.id });
  };
  const transactionDetailRecord = () => {
    const index = transactionDetailIndex();
    return index === null ? undefined : props.transactions?.[index];
  };
  const moveSelectedStateRow = (direction: 1 | -1) => {
    const rows = stateRows();
    if (rows.length === 0) {
      return;
    }

    const index = Math.max(0, selectedStateRowIndex());
    const next = rows[(index + direction + rows.length) % rows.length];
    if (next !== undefined) {
      setSelectedStateRowId(next.id);
    }
  };
  const selectStateRow = (index: number) => {
    const row = stateRows()[index];
    if (row !== undefined) {
      setFocusedPanel("state");
      setSelectedStateRowId(row.id);
    }
  };
  const openSelectedStateRowDetail = () => {
    const row = selectedStateRow();
    if (row !== undefined) {
      setStateDetailRowId(row.id);
      setStateDetailSnapshot(null);
      setStateKeyBookVisible(false);
      setStateKeyBookQuery("");
      setStateKeyBookSelectedIndex(0);
      setStateKeyBookActionIndex(null);
      requestStateRowDetail(row);
    }
  };
  const requestStateRowDetail = (row: StateSelectableRow) => {
    const handler = props.onStateDetailRequest;
    const session = props.session;
    const deployedContract = activeDeployedContract();
    if (handler === undefined || row.kind !== "storage" || session === undefined || deployedContract === null) {
      return;
    }

    const rowId = row.id;
    const result = handler({
      session,
      deployedContract,
      rowId,
      showDefaults: true,
    });
    void Promise.resolve(result).then((snapshot) => {
      if (snapshot !== undefined && stateDetailRowId() === rowId && activeDeployedContract()?.id === deployedContract.id) {
        setStateDetailSnapshot(snapshot);
      }
    }).catch((error: unknown) => {
      if (stateDetailRowId() === rowId) {
        setStateDetailSnapshot({
          rowId,
          title: stateDetailTitle(),
          lines: [error instanceof Error ? error.message : String(error)],
          copyValue: null,
        });
      }
    });
  };
  const stateDetailKeyBookEntries = (): readonly DevStateKeyBookDetailEntry[] => {
    const loaded = stateDetailSnapshot();
    return loaded !== null && loaded.rowId === stateDetailRowId() ? loaded.keyBookEntries ?? [] : [];
  };
  const filteredStateKeyBookEntries = (): readonly DevStateKeyBookDetailEntry[] => {
    const query = stateKeyBookQuery().trim().toLowerCase();
    const entries = stateDetailKeyBookEntries();
    if (query.length === 0) {
      return entries;
    }
    return entries.filter((entry) =>
      [entry.label ?? "", entry.value, entry.type].some((value) => value.toLowerCase().includes(query))
    );
  };
  const selectedStateKeyBookEntry = () => {
    const entries = filteredStateKeyBookEntries();
    if (entries.length === 0) {
      return undefined;
    }
    return entries[Math.min(stateKeyBookSelectedIndex(), entries.length - 1)];
  };
  createEffect(() => {
    const entries = filteredStateKeyBookEntries();
    if (entries.length === 0) {
      setStateKeyBookSelectedIndex(0);
      return;
    }
    if (stateKeyBookSelectedIndex() >= entries.length) {
      setStateKeyBookSelectedIndex(entries.length - 1);
    }
  });
  const moveStateKeyBookSelection = (direction: 1 | -1) => {
    const count = filteredStateKeyBookEntries().length;
    if (count === 0) {
      return;
    }
    setStateKeyBookSelectedIndex((index) => (index + direction + count) % count);
  };
  const stateKeyBookActions = (): readonly StateKeyBookAction[] =>
    selectedStateKeyBookEntry() === undefined ? ["add"] : ["edit", "delete", "add"];
  const stateKeyBookActionOptions = (): readonly PickerActionOption[] => {
    const currentGroup = t("tui.state.keyBook.currentGroup");
    const listGroup = t("tui.state.keyBook.listGroup");
    return stateKeyBookActions().map((action) => ({
      id: action,
      label: action === "add" ? t("tui.state.keyBook.add") : action === "edit" ? t("tui.state.keyBook.editLabel") : t("tui.state.keyBook.delete"),
      group: action === "add" ? listGroup : currentGroup,
      ...(action === "delete" ? { danger: true } : {}),
    }));
  };
  const moveStateKeyBookAction = (direction: 1 | -1) => {
    setStateKeyBookActionIndex((index) => {
      if (index === null) {
        return null;
      }
      const count = stateKeyBookActions().length;
      return count === 0 ? null : (index + direction + count) % count;
    });
  };
  const applyStateKeyBookChange = (change: DevStateKeyBookChange) => {
    const result = props.onStateKeyBookChange?.(change);
    void Promise.resolve(result).then(() => {
      const row = stateDetailRow();
      if (row !== undefined) {
        requestStateRowDetail(row);
      }
    });
  };
  const deleteSelectedStateKeyBookEntry = () => {
    const entry = selectedStateKeyBookEntry();
    const layoutId = props.stateSnapshot?.storageLayoutId;
    if (entry === undefined || layoutId === undefined || layoutId === null || props.onStateKeyBookChange === undefined) {
      return;
    }

    applyStateKeyBookChange({
      action: "delete_key",
      layoutId,
      type: entry.type,
      value: entry.value,
    });
    setStateKeyBookActionIndex(null);
  };
  const stateDetailLines = (): readonly StateDetailLine[] => {
    const loaded = stateDetailSnapshot();
    if (loaded !== null && loaded.rowId === stateDetailRowId()) {
      return loaded.lines.map((line) => ({
        fg: theme.color.text,
        content: line,
      }));
    }

    const row = stateDetailRow();
    if (row === undefined) {
      return [];
    }

    return row.kind === "value"
      ? stateValueDetailLines(row.value, t)
      : stateStorageRowDetailLines(row.row, t);
  };
  const stateDetailTitle = () => {
    const loaded = stateDetailSnapshot();
    if (loaded !== null && loaded.rowId === stateDetailRowId()) {
      return loaded.title;
    }

    const row = stateDetailRow();
    if (row === undefined) {
      return t("tui.state.detail.title");
    }

    return `${t("tui.state.detail.title")}: ${row.kind === "value" ? row.value.name : row.row.name}`;
  };
  const stateDetailCanManageKeys = () => {
    const row = stateDetailRow();
    return row?.kind === "storage"
      && row.row.kind === "mapping"
      && props.stateSnapshot?.storageLayoutId !== undefined
      && activeDeployedContract() !== null
      && mappingKeyTypeFromTypeLabel(row.row.typeLabel) !== null
      && props.onStateKeyBookChange !== undefined;
  };
  const stateDetailMappingKeyType = () => {
    const row = stateDetailRow();
    return row?.kind === "storage" ? mappingKeyTypeFromTypeLabel(row.row.typeLabel) : null;
  };
  const stateDetailHint = () => {
    if (!stateDetailCanManageKeys()) {
      return t("tui.state.detail.hint");
    }
    return t("tui.state.detail.mappingHint");
  };
  const openStateKeyBookList = () => {
    if (!stateDetailCanManageKeys()) {
      return;
    }
    setStateKeyBookVisible(true);
    setStateKeyBookQuery("");
    setStateKeyBookActionIndex(null);
    setStateKeyBookSelectedIndex(0);
  };
  const openStateKeyBookAddModal = () => {
    const row = stateDetailRow();
    const layoutId = props.stateSnapshot?.storageLayoutId;
    const deployed = activeDeployedContract();
    if (row?.kind !== "storage" || row.row.kind !== "mapping" || layoutId === undefined || layoutId === null || deployed === null) {
      return;
    }

    const keyType = mappingKeyTypeFromTypeLabel(row.row.typeLabel);
    if (keyType === null) {
      return;
    }

    setStateKeyBookVisible(false);
    setStateKeyBookActionIndex(null);
    setStateKeyBookDraft({
      mode: "add",
      layoutId,
      target: deployed.target,
      contract: deployed.contract,
      keyType,
      keyText: "",
      labelText: "",
      activeField: "key",
    });
  };
  const openStateKeyBookEditModal = () => {
    const entry = selectedStateKeyBookEntry();
    const row = stateDetailRow();
    const layoutId = props.stateSnapshot?.storageLayoutId;
    const deployed = activeDeployedContract();
    if (entry === undefined || row?.kind !== "storage" || layoutId === undefined || layoutId === null || deployed === null) {
      return;
    }

    setStateKeyBookVisible(false);
    setStateKeyBookActionIndex(null);
    setStateKeyBookDraft({
      mode: "edit",
      layoutId,
      target: deployed.target,
      contract: deployed.contract,
      keyType: entry.type,
      keyText: entry.value,
      labelText: entry.label ?? "",
      activeField: "label",
    });
  };
  const updateStateKeyBookDraft = (change: Partial<Pick<StateKeyBookDraft, "keyText" | "labelText" | "activeField" | "error">>) => {
    setStateKeyBookDraft((draft) => {
      if (draft === null) {
        return null;
      }
      if (change.keyText !== undefined || change.labelText !== undefined) {
        const { error: _error, ...rest } = draft;
        return { ...rest, ...change };
      }
      return { ...draft, ...change };
    });
  };
  const submitStateKeyBookDraft = () => {
    const draft = stateKeyBookDraft();
    if (draft === null) {
      return;
    }

    const value = draft.keyText.trim();
    if (value.length === 0) {
      updateStateKeyBookDraft({ error: t("tui.state.keyBook.emptyKey") });
      return;
    }

    applyStateKeyBookChange({
      action: "add_key",
      layoutId: draft.layoutId,
      target: draft.target,
      contract: draft.contract,
      key: {
        type: draft.keyType,
        value,
        label: draft.labelText.trim().length === 0 ? null : draft.labelText.trim(),
        enabled: true,
      },
    });
    setStateKeyBookDraft(null);
    openStateKeyBookList();
  };
  const updateStateKeyBookQuery = (query: string) => {
    setStateKeyBookQuery(query);
    setStateKeyBookSelectedIndex(0);
    setStateKeyBookActionIndex(null);
  };
  const runSelectedStateKeyBookAction = () => {
    const action = stateKeyBookActions()[stateKeyBookActionIndex() ?? 0];
    if (action === "add") {
      openStateKeyBookAddModal();
      return;
    }
    if (action === "edit") {
      openStateKeyBookEditModal();
      return;
    }
    if (action === "delete") {
      deleteSelectedStateKeyBookEntry();
    }
  };
  const copyStateDetail = () => {
    const loaded = stateDetailSnapshot();
    if (loaded !== null && loaded.copyValue !== null && loaded.copyValue.length > 0) {
      props.onCopyText?.(loaded.copyValue);
      return;
    }

    const text = stateDetailText(stateDetailLines());
    if (text.length > 0) {
      props.onCopyText?.(text);
    }
  };
  const settingsSnapshot = (): DevSettingsSnapshot => props.settings ?? {
    language: props.locale,
    resolvedLocale: props.locale,
    systemLocale: props.locale,
    showRawStateValues: true,
    hideNoArgReadActions: false,
  };
  const showStateRawValues = () => localStateRawVisible() ?? settingsSnapshot().showRawStateValues;
  const selectedSettingsSection = () => settingsSections[selectedSettingsIndex()] ?? "language";
  const selectLanguagePreference = (language: LocalePreference) => {
    setSettingsMessage("");
    const result = props.onSettingsChange?.({ language });
    if (result === undefined) {
      return;
    }
    void Promise.resolve(result).then((next) => {
      if (next !== undefined) {
        setSettingsMessage(t("tui.settings.saved", { value: languagePreferenceLabel(next.language, t) }));
      }
    }).catch((error: unknown) => {
      setSettingsMessage(error instanceof Error ? error.message : String(error));
    });
  };
  const selectShowRawStateValues = (showRawStateValues: boolean) => {
    setSettingsMessage("");
    const result = props.onSettingsChange?.({ showRawStateValues });
    if (result === undefined) {
      return;
    }
    void Promise.resolve(result).then((next) => {
      if (next !== undefined) {
        setSettingsMessage(t("tui.settings.saved", { value: stateRawDisplayLabel(next.showRawStateValues, t) }));
      }
    }).catch((error: unknown) => {
      setSettingsMessage(error instanceof Error ? error.message : String(error));
    });
  };
  const selectHideNoArgReadActions = (hideNoArgReadActions: boolean) => {
    setSettingsMessage("");
    const result = props.onSettingsChange?.({ hideNoArgReadActions });
    if (result === undefined) {
      return;
    }
    void Promise.resolve(result).then((next) => {
      if (next !== undefined) {
        setSettingsMessage(t("tui.settings.saved", { value: contractActionFilterLabel(next.hideNoArgReadActions, t) }));
      }
    }).catch((error: unknown) => {
      setSettingsMessage(error instanceof Error ? error.message : String(error));
    });
  };
  const cycleDraftLanguage = (direction: 1 | -1) => {
    const current = draftLanguage();
    const index = languagePreferences.indexOf(current);
    setDraftLanguage(languagePreferences[(index + direction + languagePreferences.length) % languagePreferences.length] ?? "system");
  };
  const syncSettingsDrafts = () => {
    setDraftLanguage(settingsSnapshot().language);
    setDraftShowRawStateValues(settingsSnapshot().showRawStateValues);
    setDraftHideNoArgReadActions(settingsSnapshot().hideNoArgReadActions);
  };

  createEffect(() => {
    const count = props.transactions?.length ?? 0;
    if (count === 0) {
      setSelectedTransactionIndex(0);
      setTransactionDetailIndex(null);
      return;
    }

    if (selectedTransactionIndex() >= count) {
      setSelectedTransactionIndex(count - 1);
    }
    const detailIndex = transactionDetailIndex();
    if (detailIndex !== null && detailIndex >= count) {
      setTransactionDetailIndex(null);
    }
  });

  useKeyboard((key) => {
    if (shortcutsVisible()) {
      if (isExitConfirmKey(key)) {
        key.preventDefault();
        key.stopPropagation();
        setShortcutsVisible(false);
        setExitConfirmVisible(true);
        return;
      }

      if (key.name === "escape" || key.name === "?" || key.sequence === "?") {
        setShortcutsVisible(false);
      }
      return;
    }

    if (exitConfirmVisible()) {
      if (isExitConfirmKey(key)) {
        key.preventDefault();
        key.stopPropagation();
        props.onExitRequest?.();
        return;
      }

      if (key.name === "escape") {
        key.preventDefault();
        key.stopPropagation();
        setExitConfirmVisible(false);
      }
      return;
    }

    if (transactionDetailIndex() !== null) {
      if (isPlainKey(key, "y")) {
        key.preventDefault();
        key.stopPropagation();
        const record = transactionDetailRecord();
        if (record !== undefined) {
          props.onCopyText?.(transactionDetailText(record, t));
        }
        return;
      }

      if (key.name === "escape") {
        key.preventDefault();
        key.stopPropagation();
        setTransactionDetailIndex(null);
      }
      return;
    }

    if (stateKeyBookDraft() !== null) {
      if (key.name === "escape") {
        key.preventDefault();
        key.stopPropagation();
        setStateKeyBookDraft(null);
        openStateKeyBookList();
        return;
      }

      if (key.name === "tab") {
        key.preventDefault();
        key.stopPropagation();
        const draft = stateKeyBookDraft();
        updateStateKeyBookDraft({ activeField: draft?.mode === "edit" || draft?.activeField === "key" ? "label" : "key" });
        return;
      }

      if (isEnterKey(key)) {
        key.preventDefault();
        key.stopPropagation();
        submitStateKeyBookDraft();
        return;
      }

      return;
    }

    if (stateKeyBookVisible()) {
      if (stateKeyBookActionIndex() !== null) {
        if (key.name === "up" || key.name === "down") {
          key.preventDefault();
          key.stopPropagation();
          moveStateKeyBookAction(key.name === "down" ? 1 : -1);
          return;
        }

        if (isEnterKey(key)) {
          key.preventDefault();
          key.stopPropagation();
          runSelectedStateKeyBookAction();
          return;
        }

        if (key.name === "escape" || key.name === "left") {
          key.preventDefault();
          key.stopPropagation();
          setStateKeyBookActionIndex(null);
          return;
        }

        return;
      }

      if (key.name === "up" || key.name === "down") {
        key.preventDefault();
        key.stopPropagation();
        moveStateKeyBookSelection(key.name === "down" ? 1 : -1);
        return;
      }

      if (key.name === "right" || isEnterKey(key)) {
        key.preventDefault();
        key.stopPropagation();
        setStateKeyBookActionIndex(0);
        return;
      }

      if (key.name === "escape") {
        key.preventDefault();
        key.stopPropagation();
        setStateKeyBookVisible(false);
        setStateKeyBookActionIndex(null);
      }
      return;
    }

    if (stateDetailRow() !== undefined) {
      if (isPlainKey(key, "k") && stateDetailCanManageKeys()) {
        key.preventDefault();
        key.stopPropagation();
        openStateKeyBookList();
        return;
      }

      if (isPlainKey(key, "y") || isPlainKey(key, "c")) {
        key.preventDefault();
        key.stopPropagation();
        copyStateDetail();
        return;
      }

      if (key.name === "escape") {
        key.preventDefault();
        key.stopPropagation();
        setStateDetailRowId(null);
        setStateKeyBookVisible(false);
        setStateKeyBookActionIndex(null);
      }
      return;
    }

    if (props.modal?.type === "txPreview") {
      if (key.name === "escape") {
        key.preventDefault();
        key.stopPropagation();
        cancelModal();
        return;
      }

      if (isTxPreviewGasModeLeftKey(key) || isTxPreviewGasModeRightKey(key)) {
        key.preventDefault();
        key.stopPropagation();
        props.onDevAction?.({
          type: "updateTxPreviewGasLimitMode",
          mode: isTxPreviewGasModeRightKey(key) ? "custom" : "auto",
        });
        return;
      }

      if (isTxPreviewConfirmKey(key)) {
        key.preventDefault();
        key.stopPropagation();
        confirmTxPreview(props.modal.event);
        return;
      }

      return;
    }

    if (props.modal?.type === "functionInput") {
      if (key.name === "escape") {
        key.preventDefault();
        key.stopPropagation();
        cancelModal();
        return;
      }

      if (key.name === "tab") {
        key.preventDefault();
        key.stopPropagation();
        props.onDevAction?.({
          type: "focusFunctionInputField",
          field: nextFunctionInputField(props.modal.draft),
        });
        return;
      }

      if (key.ctrl && key.name === "u") {
        key.preventDefault();
        key.stopPropagation();
        props.onDevAction?.({ type: "clearActiveFunctionInputField" });
        return;
      }

      if (key.name === "up") {
        key.preventDefault();
        key.stopPropagation();
        props.onDevAction?.({ type: "recallFunctionInputHistory", direction: -1 });
        return;
      }

      if (key.name === "down") {
        key.preventDefault();
        key.stopPropagation();
        props.onDevAction?.({ type: "recallFunctionInputHistory", direction: 1 });
        return;
      }

      if (isEnterKey(key)) {
        key.preventDefault();
        key.stopPropagation();
        props.onSubmitFunctionInput?.(props.modal.draft);
        return;
      }

      return;
    }

    const selector = selectors.activeSelector();
    if (selector.kind !== "none") {
      if (selectorActionMenu.actionIndex() !== null) {
        if (key.name === "up" || key.name === "down") {
          key.preventDefault();
          key.stopPropagation();
          selectorActionMenu.moveAction(key.name === "down" ? 1 : -1);
          return;
        }

        if (isEnterKey(key)) {
          key.preventDefault();
          key.stopPropagation();
          selectorActionMenu.runSelectedAction();
          return;
        }

        if (key.name === "escape" || key.name === "left") {
          key.preventDefault();
          key.stopPropagation();
          selectorActionMenu.reset();
          return;
        }

        return;
      }

      if (key.name === "escape") {
        key.preventDefault();
        key.stopPropagation();
        selectorActionMenu.close();
        return;
      }

      if (key.name === "down") {
        key.preventDefault();
        key.stopPropagation();
        selectorActionMenu.reset();
        selectors.moveSelectedOption(1);
        return;
      }

      if (key.name === "up") {
        key.preventDefault();
        key.stopPropagation();
        selectorActionMenu.reset();
        selectors.moveSelectedOption(-1);
        return;
      }

      if (key.name === "right") {
        key.preventDefault();
        key.stopPropagation();
        selectorActionMenu.openMenu();
        return;
      }

      if (isEnterKey(key)) {
        key.preventDefault();
        key.stopPropagation();
        selectorActionMenu.selectActiveOption();
        return;
      }

      if ((selector.kind === "account" || selector.kind === "deployed") && isCtrlKey(key, "y")) {
        key.preventDefault();
        key.stopPropagation();
        selectorActionMenu.copySelectedAddress();
        return;
      }

      if (selector.kind === "deployed" && isCtrlKey(key, "x")) {
        key.preventDefault();
        key.stopPropagation();
        selectorActionMenu.deleteSelectedDeployedContract();
        return;
      }

      return;
    }

    if (key.name === "?" || key.sequence === "?") {
      setShortcutsVisible(true);
      return;
    }

    if (key.name === "[" || key.sequence === "[") {
      key.preventDefault();
      key.stopPropagation();
      nextTopTab(-1);
      return;
    }

    if (key.name === "]" || key.sequence === "]") {
      key.preventDefault();
      key.stopPropagation();
      nextTopTab(1);
      return;
    }

    if (isExitConfirmKey(key)) {
      key.preventDefault();
      key.stopPropagation();
      setExitConfirmVisible(true);
      return;
    }

    if (key.name === "b" || key.sequence === "b") {
      setActiveTopTab("diagnostics");
      props.onBuildRequest?.();
      return;
    }

    if (key.name === "r" || key.sequence === "r") {
      props.onRefreshRequest?.();
      return;
    }

    if (isPlainKey(key, "n")) {
      key.preventDefault();
      key.stopPropagation();
      openSelector("network");
      return;
    }

    if (isPlainKey(key, "a")) {
      key.preventDefault();
      key.stopPropagation();
      openSelector("account");
      return;
    }

    if (activeTopTab() === "transactions") {
      if (key.name === "down") {
        key.preventDefault();
        key.stopPropagation();
        moveSelectedTransaction(1);
        return;
      }

      if (key.name === "up") {
        key.preventDefault();
        key.stopPropagation();
        moveSelectedTransaction(-1);
        return;
      }

      if (isEnterKey(key)) {
        key.preventDefault();
        key.stopPropagation();
        openSelectedTransaction();
        return;
      }

      return;
    }

    if (activeTopTab() === "events") {
      const count = props.eventRecords?.length ?? 0;
      if (key.name === "down" && count > 0) {
        key.preventDefault();
        key.stopPropagation();
        setSelectedEventIndex((index) => (index + 1 + count) % count);
        return;
      }

      if (key.name === "up" && count > 0) {
        key.preventDefault();
        key.stopPropagation();
        setSelectedEventIndex((index) => (index - 1 + count) % count);
        return;
      }

      return;
    }

    if (activeTopTab() === "settings") {
      if (key.name === "escape") {
        key.preventDefault();
        key.stopPropagation();
        syncSettingsDrafts();
        return;
      }

      if (key.name === "down") {
        key.preventDefault();
        key.stopPropagation();
        setSelectedSettingsIndex((index) => (index + 1 + settingsSections.length) % settingsSections.length);
        return;
      }

      if (key.name === "up") {
        key.preventDefault();
        key.stopPropagation();
        setSelectedSettingsIndex((index) => (index - 1 + settingsSections.length) % settingsSections.length);
        return;
      }

      if (key.name === "right" || key.name === "left") {
        key.preventDefault();
        key.stopPropagation();
        const section = selectedSettingsSection();
        if (section === "language") {
          cycleDraftLanguage(key.name === "right" ? 1 : -1);
        } else if (section === "stateDisplay") {
          setDraftShowRawStateValues((value) => !value);
        } else {
          setDraftHideNoArgReadActions((value) => !value);
        }
        return;
      }

      if (isEnterKey(key)) {
        key.preventDefault();
        key.stopPropagation();
        const section = selectedSettingsSection();
        if (section === "language") {
          selectLanguagePreference(draftLanguage());
        } else if (section === "stateDisplay") {
          selectShowRawStateValues(draftShowRawStateValues());
        } else {
          selectHideNoArgReadActions(draftHideNoArgReadActions());
        }
        return;
      }

      return;
    }

    if (activeTopTab() !== "dev") {
      return;
    }

    if (focusedPanel() === "state") {
      if (key.name === "down" && stateRows().length > 0) {
        key.preventDefault();
        key.stopPropagation();
        moveSelectedStateRow(1);
        return;
      }

      if (key.name === "up" && stateRows().length > 0) {
        key.preventDefault();
        key.stopPropagation();
        moveSelectedStateRow(-1);
        return;
      }

      if (isEnterKey(key) && stateRows().length > 0) {
        key.preventDefault();
        key.stopPropagation();
        openSelectedStateRowDetail();
        return;
      }

      if (isPlainKey(key, "o")) {
        key.preventDefault();
        key.stopPropagation();
        setLocalStateRawVisible((value) => !(value ?? settingsSnapshot().showRawStateValues));
        return;
      }
    }

    if (focusedPanel() === "contract" && isPlainKey(key, "g")) {
      key.preventDefault();
      key.stopPropagation();
      selectHideNoArgReadActions(!settingsSnapshot().hideNoArgReadActions);
      return;
    }

    if (isExactSequenceKey(key, "d")) {
      key.preventDefault();
      key.stopPropagation();
      openDeployInput("deploy");
      return;
    }

    if (isPlainKey(key, "c")) {
      key.preventDefault();
      key.stopPropagation();
      openSelector("deployed");
      return;
    }

    if (isPlainKey(key, "f")) {
      key.preventDefault();
      key.stopPropagation();
      openFileSelector();
      return;
    }

    if (key.name === "tab") {
      key.preventDefault();
      key.stopPropagation();
      nextPanel(1);
      return;
    }

    if (focusedPanel() === "contract" && key.name === "right") {
      key.preventDefault();
      key.stopPropagation();
      moveSelectedSourceTarget(1);
      return;
    }

    if (focusedPanel() === "contract" && key.name === "left") {
      key.preventDefault();
      key.stopPropagation();
      moveSelectedSourceTarget(-1);
      return;
    }

    if (focusedPanel() === "contract" && key.name === "down") {
      key.preventDefault();
      key.stopPropagation();
      moveSelectedFunction(1);
      return;
    }

    if (focusedPanel() === "contract" && key.name === "up") {
      key.preventDefault();
      key.stopPropagation();
      moveSelectedFunction(-1);
      return;
    }

    if (focusedPanel() === "contract" && isEnterKey(key)) {
      key.preventDefault();
      key.stopPropagation();
      openSelectedFunctionInput();
      return;
    }
  });

  return (
    <box width="100%" height="100%" flexDirection="column" padding={0} rowGap={0} backgroundColor={theme.color.bg}>
      <box border borderStyle="rounded" height={useTallStatusBar() ? 4 : 3} title={t("app.name")} borderColor={theme.color.border}>
        <StatusBar
          network={selectors.activeNetwork()}
          account={selectors.activeAccount()}
          compact={!useTallStatusBar()}
          {...(props.accountStatus === undefined ? {} : { accountStatus: props.accountStatus })}
          translate={t}
        />
      </box>
      <TopTabStrip
        activeTab={activeTopTab()}
        focused={false}
        translate={t}
        onChange={(tab) => {
          setActiveTopTab(tab);
        }}
      />
      {activeTopTab() === "dev" ? (
        <box flexGrow={1} flexDirection={isWide() ? "row" : "column"} columnGap={theme.space.panelGap} rowGap={0}>
          <PanelBox
            panel="contract"
            focused={focusedPanel() === "contract"}
            title={contractPanelTitle(props.session, t)}
            bottomTitle={t("tui.panel.contract.footer")}
            wide={isWide()}
            onFocus={() => focusPanel("contract")}
          >
            <ContractDetails
              session={props.session}
              {...(props.stateSnapshot === undefined ? {} : { stateSnapshot: props.stateSnapshot })}
              fallback={t("tx.preview.title")}
              translate={t}
              contentWidth={contractPanelContentWidth()}
              contentHeight={dimensions().height}
              selectedFunctionIndex={selectedFunctionIndex()}
              selectedSourceTargetIndex={selectedSourceTargetIndex()}
              hideNoArgReadActions={settingsSnapshot().hideNoArgReadActions}
              activeDeployedContract={activeDeployedContract()}
              deployedContracts={props.deployedContracts ?? []}
              onFunctionSelect={(index) => { focusPanel("contract"); setSelectedFunctionIndex(index); }}
              onFunctionOpen={(index) => { focusPanel("contract"); setSelectedFunctionIndex(index); openFunctionInputAtIndex(index); }}
              onSourceTargetSelect={selectSourceTarget}
            />
          </PanelBox>
          <box flexGrow={0} width={isWide() ? "50%" : "100%"} height={isWide() ? "100%" : "auto"} flexDirection="column" rowGap={0}>
            <PanelBox
              panel="state"
              focused={focusedPanel() === "state"}
              title={panelTitle("state")}
              bottomTitle={t("tui.panel.state.footer")}
              wide={isWide()}
              stacked={isWide()}
              onFocus={() => focusPanel("state")}
            >
              <StateDetails
                snapshot={props.stateSnapshot}
                fallback={t("tui.state.loading")}
                translate={t}
                activeDeployedContract={activeDeployedContract()}
                showRawValues={showStateRawValues()}
                selectedRowIndex={selectedStateRowIndex()}
                onRowSelect={selectStateRow}
              />
            </PanelBox>
            <PanelBox
              panel="feed"
              focused={focusedPanel() === "feed"}
              title={panelTitle("feed")}
              {...(props.feedEntries === undefined ? { body: t("tui.status.scroll", { offset: feedScroll() }) } : {})}
              wide={isWide()}
              stacked={isWide()}
              onFocus={() => focusPanel("feed")}
              onScroll={() => {
                focusPanel("feed");
                setFeedScroll((offset) => offset + 1);
              }}
            >
              {props.feedEntries === undefined ? undefined : <FeedScroll entries={props.feedEntries} />}
            </PanelBox>
          </box>
        </box>
      ) : activeTopTab() === "transactions" ? (
        <TopTabPanel title={t("tui.tab.transactions")} bottomTitle={t("tui.transactions.footer")} focused>
          <TransactionsDetails
            records={props.transactions ?? []}
            fallback={t("tui.transactions.empty")}
            translate={t}
            selectedIndex={selectedTransactionIndex()}
            onRecordSelect={setSelectedTransactionIndex}
            onRecordOpen={setTransactionDetailIndex}
          />
        </TopTabPanel>
      ) : activeTopTab() === "events" ? (
        <TopTabPanel title={t("tui.tab.events")} bottomTitle={t("tui.events.footer")} focused>
          <EventsDetails
            records={props.eventRecords ?? []}
            fallback={t("tui.events.empty")}
            translate={t}
            selectedIndex={selectedEventIndex()}
            activeDeployedContract={activeDeployedContract()}
          />
        </TopTabPanel>
      ) : activeTopTab() === "diagnostics" ? (
        <TopTabPanel title={t("tui.tab.diagnostics")} bottomTitle={t("tui.diagnostics.footer")} focused>
          <DiagnosticsDetails
            snapshot={props.diagnosticsSnapshot}
            fallback={t("tui.diagnostics.empty")}
            translate={t}
          />
        </TopTabPanel>
      ) : (
        <TopTabPanel title={t("tui.tab.settings")} bottomTitle={t("tui.settings.footer")} focused>
          <SettingsDetails
            settings={settingsSnapshot()}
            selectedIndex={selectedSettingsIndex()}
            draftLanguage={draftLanguage()}
            draftShowRawStateValues={draftShowRawStateValues()}
            draftHideNoArgReadActions={draftHideNoArgReadActions()}
            message={settingsMessage()}
            translate={t}
            onSettingSelect={(section) => {
              setSelectedSettingsIndex(settingsSections.indexOf(section));
            }}
            onDraftLanguageSelect={setDraftLanguage}
            onDraftShowRawStateValuesSelect={setDraftShowRawStateValues}
            onDraftHideNoArgReadActionsSelect={setDraftHideNoArgReadActions}
            onSaveLanguage={() => {
              selectLanguagePreference(draftLanguage());
            }}
            onSaveShowRawStateValues={() => {
              selectShowRawStateValues(draftShowRawStateValues());
            }}
            onSaveHideNoArgReadActions={() => {
              selectHideNoArgReadActions(draftHideNoArgReadActions());
            }}
          />
        </TopTabPanel>
      )}
      <ShortcutBar translate={t} activeTab={activeTopTab()} />
      <DevSelectorLayer
        selector={selectors.activeSelector()}
        preview={hasSelectorPreview()}
        modalLeft={selectorRect().left}
        modalTop={selectorRect().top}
        modalWidth={selectorRect().width}
        modalHeight={selectorRect().height}
        translate={t}
        query={selectors.selectorQuery}
        options={selectors.filteredSelectorOptions()}
        selectedIndex={selectors.selectorSelectedIndex}
        actionOptions={selectorActionMenu.actionOptions()}
        actionMenuIndex={selectorActionMenu.actionIndex()}
        {...(props.entrySelectorType === undefined ? {} : { entrySelectorType: props.entrySelectorType })}
        onQueryChange={selectorActionMenu.updateQuery}
        onSelect={selectors.selectOption}
      />
      {shortcutsVisible() ? <ShortcutOverlay translate={t} rect={shortcutRect()} /> : null}
      {exitConfirmVisible() ? <ExitConfirmModal translate={t} rect={shortcutRect()} /> : null}
      <TxPreviewModalLayer
        modal={props.modal}
        translate={t}
        rect={actionModalRect()}
        onGasLimitModeChange={(mode) => {
          props.onDevAction?.({ type: "updateTxPreviewGasLimitMode", mode });
        }}
        onGasLimitChange={(value) => {
          props.onDevAction?.({ type: "updateTxPreviewGasLimit", value });
        }}
      />
      <FunctionInputModalBridge
        modal={props.modal}
        translate={t}
        rect={actionModalRect()}
        {...(props.functionInputError === undefined ? {} : { error: props.functionInputError })}
        {...(props.onDevAction === undefined ? {} : { onDevAction: props.onDevAction })}
      />
      <Show when={transactionDetailRecord()}>
        {(record: Accessor<DevTransactionRecord>) => <TransactionDetailModal record={record()} translate={t} rect={actionModalRect()} />}
      </Show>
      <Show when={stateDetailRow()}>
        {() => (
          <StateDetailModal
            title={stateDetailTitle()}
            lines={stateDetailLines()}
            hint={stateDetailHint()}
            rect={actionModalRect()}
          />
        )}
      </Show>
      <Show when={stateKeyBookVisible()}>
        {() => (
          <StateKeyBookListModal
            rect={stateKeyBookModalRect()}
            translate={t}
            keyType={stateDetailMappingKeyType() ?? ""}
            entries={filteredStateKeyBookEntries()}
            selectedIndex={stateKeyBookSelectedIndex()}
            query={stateKeyBookQuery()}
            actions={stateKeyBookActionOptions()}
            actionMenuIndex={stateKeyBookActionIndex()}
            onQueryChange={updateStateKeyBookQuery}
          />
        )}
      </Show>
      <Show when={stateKeyBookDraft()}>
        {(draft: Accessor<StateKeyBookDraft>) => (
          <StateKeyBookModal
            rect={stateKeyBookModalRect()}
            translate={t}
            mode={draft().mode}
            keyType={draft().keyType}
            keyText={draft().keyText}
            labelText={draft().labelText}
            activeField={draft().activeField}
            {...(draft().error === undefined ? {} : { error: draft().error })}
            onKeyChange={(value) => {
              updateStateKeyBookDraft({ keyText: value });
            }}
            onLabelChange={(value) => {
              updateStateKeyBookDraft({ labelText: value });
            }}
            onSubmit={submitStateKeyBookDraft}
          />
        )}
      </Show>
    </box>
  );
}

function stateValueRowId(value: DevStateValueSnapshot): string {
  return `abi:${value.signature}`;
}

function mappingKeyTypeFromTypeLabel(typeLabel: string): string | null {
  const match = typeLabel.match(/^mapping\s*\((.+?)\s*=>/);
  const keyType = match?.[1]?.trim();
  return keyType === undefined || keyType.length === 0 ? null : keyType;
}

function currentUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function isExitConfirmKey(key: { readonly ctrl?: boolean; readonly meta?: boolean; readonly name?: string; readonly sequence?: string }): boolean {
  return isPlainKey(key, "q");
}

function isPlainKey(key: { readonly ctrl?: boolean; readonly meta?: boolean; readonly name?: string; readonly sequence?: string }, value: string): boolean {
  if (key.ctrl === true || key.meta === true) {
    return false;
  }
  return key.name?.toLowerCase() === value || key.sequence?.toLowerCase() === value;
}

function isExactSequenceKey(key: { readonly name?: string; readonly sequence?: string }, value: string): boolean {
  return key.sequence === value || (key.sequence === undefined && key.name === value);
}

function isCtrlKey(key: { readonly ctrl?: boolean; readonly name?: string; readonly sequence?: string }, value: string): boolean {
  const controlSequence = value === "c" ? "\u0003" : value === "o" ? "\u000f" : value === "x" ? "\u0018" : value === "y" ? "\u0019" : "";
  return (controlSequence !== "" && key.sequence === controlSequence)
    || (key.ctrl === true && (key.name?.toLowerCase() === value || key.sequence?.toLowerCase() === value));
}

function TopTabStrip(props: {
  readonly activeTab: DevTopTab;
  readonly focused: boolean;
  readonly translate: (key: MessageKey, values?: Record<string, string | number>) => string;
  readonly onChange: (tab: DevTopTab) => void;
}) {
  let tabs: TabSelectRenderable | undefined;
  const tabWidth = 14;
  const options = createMemo(() =>
    topTabs.map((tab) => ({
      name: props.translate(topTabKeys[tab]),
      description: props.translate(topTabDescriptionKeys[tab]),
      value: tab,
    })),
  );
  createEffect(() => {
    tabs?.setSelectedIndex(topTabs.indexOf(props.activeTab));
  });
  const selectTabFromMouse = (event: MouseEvent) => {
    const left = event.target?.x ?? 0;
    const index = Math.floor((event.x - left) / tabWidth);
    const tab = topTabs[index];
    if (tab === undefined) {
      return;
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    props.onChange(tab);
    tabs?.setSelectedIndex(index);
  };

  return (
    <box id="top-tabs" height={3} border borderStyle="rounded" borderColor={theme.color.border} paddingX={1} backgroundColor={theme.color.bg} flexDirection="row">
      <tab_select
        id="top-tab-select"
        ref={(renderable) => {
          tabs = renderable;
        }}
        focused={props.focused}
        width={70}
        tabWidth={tabWidth}
        options={options()}
        backgroundColor={theme.color.bg}
        textColor={theme.color.muted}
        focusedBackgroundColor={theme.color.bg}
        focusedTextColor={theme.color.text}
        selectedBackgroundColor={theme.color.selectionBg}
        selectedTextColor={theme.color.selected}
        selectedDescriptionColor={theme.color.muted}
        showDescription={false}
        showScrollArrows={false}
        showUnderline={false}
        wrapSelection
        onMouseDown={selectTabFromMouse}
        onChange={(index) => {
          props.onChange(topTabs[index] ?? "dev");
        }}
      />
    </box>
  );
}

function SettingsDetails(props: {
  readonly settings: DevSettingsSnapshot;
  readonly selectedIndex: number;
  readonly draftLanguage: LocalePreference;
  readonly draftShowRawStateValues: boolean;
  readonly draftHideNoArgReadActions: boolean;
  readonly message: string;
  readonly translate: (key: MessageKey, values?: Record<string, string | number>) => string;
  readonly onSettingSelect: (section: SettingsSection) => void;
  readonly onDraftLanguageSelect: (language: LocalePreference) => void;
  readonly onDraftShowRawStateValuesSelect: (value: boolean) => void;
  readonly onDraftHideNoArgReadActionsSelect: (value: boolean) => void;
  readonly onSaveLanguage: () => void;
  readonly onSaveShowRawStateValues: () => void;
  readonly onSaveHideNoArgReadActions: () => void;
}) {
  return (
    <box width="100%" height="100%" flexDirection="column" paddingX={1} rowGap={0}>
      <SettingsMenuRow
        selected={props.selectedIndex === 0}
        title={props.translate("tui.settings.language.title")}
        value={languagePreferenceLabel(props.draftLanguage, props.translate)}
        onSelect={() => props.onSettingSelect("language")}
        onValuePrev={() => props.onDraftLanguageSelect(previousLanguagePreference(props.draftLanguage))}
        onValueNext={() => props.onDraftLanguageSelect(nextLanguagePreference(props.draftLanguage))}
        onSave={props.onSaveLanguage}
      />
      <SettingsMenuRow
        selected={props.selectedIndex === 1}
        title={props.translate("tui.settings.stateDisplay.title")}
        value={stateRawDisplayLabel(props.draftShowRawStateValues, props.translate)}
        onSelect={() => props.onSettingSelect("stateDisplay")}
        onValuePrev={() => props.onDraftShowRawStateValuesSelect(!props.draftShowRawStateValues)}
        onValueNext={() => props.onDraftShowRawStateValuesSelect(!props.draftShowRawStateValues)}
        onSave={props.onSaveShowRawStateValues}
      />
      <SettingsMenuRow
        selected={props.selectedIndex === 2}
        title={props.translate("tui.settings.contractActions.title")}
        value={contractActionFilterLabel(props.draftHideNoArgReadActions, props.translate)}
        onSelect={() => props.onSettingSelect("contractActions")}
        onValuePrev={() => props.onDraftHideNoArgReadActionsSelect(!props.draftHideNoArgReadActions)}
        onValueNext={() => props.onDraftHideNoArgReadActionsSelect(!props.draftHideNoArgReadActions)}
        onSave={props.onSaveHideNoArgReadActions}
      />
      <box height={1} />
      <text fg={theme.color.muted} content={props.translate("tui.settings.language.resolved", { locale: props.settings.resolvedLocale })} />
      <text fg={theme.color.muted} content={props.translate("tui.settings.language.system", { locale: props.settings.systemLocale })} />
      <text fg={theme.color.muted} content={props.translate("tui.settings.singlePageHint")} />
      {props.settings.configPath === undefined ? null : (
        <text fg={theme.color.code} content={props.translate("tui.settings.configPath", { path: props.settings.configPath })} wrapMode="word" />
      )}
      {props.message.length === 0 ? null : <text fg={theme.color.read} content={props.message} wrapMode="word" />}
    </box>
  );
}

function SettingsMenuRow(props: {
  readonly selected: boolean;
  readonly title: string;
  readonly value: string;
  readonly onSelect: () => void;
  readonly onValuePrev: () => void;
  readonly onValueNext: () => void;
  readonly onSave: () => void;
}) {
  return (
    <box
      height={1}
      flexDirection="row"
      backgroundColor={props.selected ? theme.color.selectionBg : theme.color.bg}
      onMouseDown={props.onSelect}
    >
      <text flexShrink={0} fg={props.selected ? theme.color.selected : theme.color.muted} content={props.selected ? "› " : "  "} />
      <text flexShrink={0} fg={props.selected ? theme.color.selected : theme.color.text} content={props.title} />
      <text flexShrink={0} fg={theme.color.border} content="  " />
      <box
        height={1}
        flexDirection="row"
        onMouseDown={(event: MouseEvent) => {
          event.preventDefault?.();
          event.stopPropagation?.();
          props.onSelect();
          props.onValueNext();
        }}
      >
        <text flexShrink={0} fg={props.selected ? theme.color.muted : theme.color.border} content="< " />
        <text flexShrink={0} fg={props.selected ? theme.color.selected : theme.color.muted} content={props.value} />
        <text flexShrink={0} fg={props.selected ? theme.color.muted : theme.color.border} content=" >" />
      </box>
      <box
        height={1}
        onMouseDown={(event: MouseEvent) => {
          event.preventDefault?.();
          event.stopPropagation?.();
          props.onSelect();
          props.onSave();
        }}
      >
        <text flexShrink={0} fg={theme.color.border} content="  " />
        <text flexShrink={0} fg={props.selected ? theme.color.text : theme.color.muted} content={props.selected ? "Enter" : ""} />
      </box>
    </box>
  );
}

function previousLanguagePreference(language: LocalePreference): LocalePreference {
  const index = languagePreferences.indexOf(language);
  return languagePreferences[(index - 1 + languagePreferences.length) % languagePreferences.length] ?? "system";
}

function nextLanguagePreference(language: LocalePreference): LocalePreference {
  const index = languagePreferences.indexOf(language);
  return languagePreferences[(index + 1 + languagePreferences.length) % languagePreferences.length] ?? "system";
}

function languagePreferenceLabel(
  language: LocalePreference,
  translate: (key: MessageKey, values?: Record<string, string | number>) => string,
): string {
  switch (language) {
    case "system":
      return translate("tui.settings.language.option.system");
    case "zh-CN":
      return translate("tui.settings.language.option.zhCN");
    case "en-US":
      return translate("tui.settings.language.option.enUS");
  }
}

function stateRawDisplayLabel(showRawStateValues: boolean, translate: (key: MessageKey, values?: Record<string, string | number>) => string): string {
  return translate(showRawStateValues ? "tui.settings.stateDisplay.showRaw.on" : "tui.settings.stateDisplay.showRaw.off");
}

function contractActionFilterLabel(
  hideNoArgReadActions: boolean,
  translate: (key: MessageKey, values?: Record<string, string | number>) => string,
): string {
  return translate(hideNoArgReadActions ? "tui.settings.contractActions.noArgReads.hidden" : "tui.settings.contractActions.noArgReads.visible");
}

function TopTabPanel(props: { readonly title: string; readonly bottomTitle?: string; readonly children: JSX.Element; readonly focused?: boolean }) {
  return (
    <box
      id={`top-tab-${props.title.toLowerCase()}`}
      flexGrow={1}
      border
      borderStyle="rounded"
      borderColor={props.focused === true ? theme.color.focusedPanelBorder : theme.color.border}
      title={props.title}
      {...(props.bottomTitle === undefined ? {} : { bottomTitle: props.bottomTitle })}
      bottomTitleAlignment="right"
      backgroundColor={theme.color.bg}
    >
      {props.children}
    </box>
  );
}

function nextFunctionInputField(draft: DevFunctionInputDraft): DevFunctionInputDraft["activeField"] {
  const fields = functionInputFields(draft);
  const currentIndex = fields.findIndex((field) => sameFunctionInputField(field, draft.activeField));
  return fields[(currentIndex + 1) % fields.length] ?? { kind: "value" };
}

function functionInputFields(draft: DevFunctionInputDraft): readonly DevFunctionInputDraft["activeField"][] {
  return [
    ...draft.function.inputs.map((_, index) => ({ kind: "argument", index }) as const),
    ...(draft.function.kind === "payable" ? [{ kind: "value" } as const] : []),
  ];
}

function sameFunctionInputField(left: DevFunctionInputDraft["activeField"], right: DevFunctionInputDraft["activeField"]): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "value") {
    return true;
  }

  if (left.kind === "gasLimit") {
    return true;
  }

  return right.kind === "argument" && left.index === right.index;
}
