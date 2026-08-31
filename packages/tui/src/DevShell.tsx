/** @jsxImportSource @opentui/solid */
import type { DevPanel } from "@consol/core";
import { createTranslator, type MessageKey } from "@consol/i18n";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, onCleanup, Show, type Accessor, type JSX } from "solid-js";
import { ChainStatePickerModal, ChainStateSaveModal } from "./ChainStateModals";
import { ExitConfirmModal } from "./ExitConfirmModal";
import { FunctionInputModalBridge } from "./FunctionInputModalBridge";
import { FunctionToolsLayer } from "./FunctionTools";
import { createFunctionToolsState } from "./function-tools-state";
import { ContractDetails, DiagnosticsDetails, EventsDetails, FeedScroll, PanelBox, StateDetails, transactionDetailText, TransactionDetailModal, TransactionsDetails } from "./DevPanels";
import {
  DevSelectorLayer,
  type DevAccountOption,
  type DevNetworkOption,
  type SelectorKind,
} from "./DevSelectorLayer";
import { selectedFunctionInputAction } from "./dev-actions";
import { isEnterKey, isTxPreviewConfirmKey, isTxPreviewGasModeLeftKey, isTxPreviewGasModeRightKey } from "./dev-keymap";
import { createDevSelectorActions, type SelectorAction } from "./dev-selector-actions";
import { basePanels, type DevTopTab, type DevWorkspacePanel, panelIcons, panelKeys, topTabIcons, topTabKeys, topTabs } from "./dev-shell-navigation";
import { createDevShellSelectorState } from "./dev-shell-selector-state";
import { createActiveDeployedContractState } from "./dev-deployed-contracts";
import { chainStateOption, currentUnix, isExactSequenceKey, isExitConfirmKey, isPlainKey, mappingKeyTypeFromTypeLabel, nextFunctionInputField, stateValueRowId } from "./dev-shell-helpers";
import { languagePreferenceLabel, languagePreferences, settingsSections, SettingsDetails, stateRawDisplayLabel, type LocalePreference, type SettingsSection } from "./dev-shell-settings";
import { initialSourceTargetIndex } from "./dev-source-targets";
import { fuzzyFilter } from "./fuzzy";
import { StatusBar, statusBarPreferredHeight } from "./DevStatusBar";
import { contractPanelTitle, displaySourceFile } from "./DevShellLabels";
import { iconLabel, nerdIcon } from "./icons";
import { centeredModalRect } from "./modal-layout";
import type { PickerActionOption } from "./PickerActionMenu";
import { ResponsivePanelGroup, type ResponsivePane } from "./ResponsivePanelGroup";
import type { SelectorOption } from "./SelectorModal";
import { ShortcutOverlay } from "./ShortcutHelp";
import { TraceModal } from "./TraceModal";
import {
  StateKeyBookListModal,
  StateKeyBookModal,
  type StateKeyBookAction,
  type StateKeyBookField,
} from "./StateKeyBookModal";
import { stateDetailText, StateDetailModal, stateStorageRowDetailLines, stateValueDetailLines, type StateDetailLine } from "./StateRows";
import { theme } from "./theme";
import { terminalCellWidth } from "./terminal-width";
import { TxPreviewModalLayer } from "./TxPreviewModalLayer";
import { TopTabPanel } from "./TopTabPanel";
import { WorkspaceBar } from "./WorkspaceBar";
import type { DevShellProps, TxPreviewEvent } from "./dev-shell-types";
import type {
  DevChainStateOption,
  DevSettingsSnapshot,
  DevStateKeyBookChange,
  DevStateKeyBookDetailEntry,
  DevStateRowDetailSnapshot,
  DevStateValueSnapshot,
  DevStorageStateRowSnapshot,
  DevTransactionRecord,
} from "./runtime-types";

export type { DevShellProps } from "./dev-shell-types";
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
type ChainStateSaveDraft = {
  readonly networkName: string;
  readonly name: string;
  readonly error?: string;
};
type ChainStatePickerState = {
  readonly networkName: string;
  readonly states: readonly DevChainStateOption[];
  readonly query: string;
  readonly selectedIndex: number;
};

export type { DevAccountOption, DevNetworkOption };
export { isExitConfirmKey } from "./dev-shell-helpers";

export function DevShell(props: DevShellProps) {
  const dimensions = useTerminalDimensions();
  const translator = createMemo(() => createTranslator(props.locale));
  const [activeTopTab, setActiveTopTab] = createSignal<DevTopTab>("dev");
  const [focusedPanel, setFocusedPanel] = createSignal<DevWorkspacePanel>("contract");
  const [selectedFunctionIndex, setSelectedFunctionIndex] = createSignal(0);
  const [selectedSourceTargetIndex, setSelectedSourceTargetIndex] = createSignal(initialSourceTargetIndex(props.session));
  const [selectedTransactionIndex, setSelectedTransactionIndex] = createSignal(0);
  const [selectedEventIndex, setSelectedEventIndex] = createSignal(0);
  const [transactionDetailIndex, setTransactionDetailIndex] = createSignal<number | null>(null);
  const deployedContractState = createActiveDeployedContractState({
    session: () => props.session,
    contracts: () => props.deployedContracts ?? [],
    preferredId: () => props.preferredActiveDeployedContractId ?? null,
    onChange: (contract) => props.onActiveDeployedContractChange?.(contract),
  });
  const { activeId: activeDeployedContractId, setActiveId: setActiveDeployedContractId, activeContract: activeDeployedContract, scopedContracts: scopedDeployedContracts } = deployedContractState;
  const [settingsMessage, setSettingsMessage] = createSignal("");
  const [selectedSettingsIndex, setSelectedSettingsIndex] = createSignal(0);
  const [draftLanguage, setDraftLanguage] = createSignal<LocalePreference>(props.settings?.language ?? "system");
  const [draftShowRawStateValues, setDraftShowRawStateValues] = createSignal(props.settings?.showRawStateValues ?? true);
  const [localStateRawVisible, setLocalStateRawVisible] = createSignal<boolean | null>(null);
  const [selectedStateRowId, setSelectedStateRowId] = createSignal<string | null>(null);
  const [stateDetailRowId, setStateDetailRowId] = createSignal<string | null>(null);
  const [stateDetailSnapshot, setStateDetailSnapshot] = createSignal<DevStateRowDetailSnapshot | null>(null);
  const [stateKeyBookDraft, setStateKeyBookDraft] = createSignal<StateKeyBookDraft | null>(null);
  const [stateKeyBookVisible, setStateKeyBookVisible] = createSignal(false);
  const [stateKeyBookQuery, setStateKeyBookQuery] = createSignal("");
  const [stateKeyBookSelectedIndex, setStateKeyBookSelectedIndex] = createSignal(0);
  const [stateKeyBookActionIndex, setStateKeyBookActionIndex] = createSignal<number | null>(null);
  const [chainStateSaveDraft, setChainStateSaveDraft] = createSignal<ChainStateSaveDraft | null>(null);
  const [chainStatePicker, setChainStatePicker] = createSignal<ChainStatePickerState | null>(null);
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
    deployedContracts: scopedDeployedContracts,
    eventContracts: () => props.deployedContracts ?? [],
    nowUnix,
    locale: () => props.locale,
    activeDeployedContractId,
    setActiveDeployedContractId,
    selectedSourceTargetIndex,
    setSelectedSourceTargetIndex,
    sourceTargetSelectionPending: () => props.sourceTargetSelectionPending === true,
    onDevAction: (action) => props.onDevAction?.(action),
    onEntrySelect: (option) => props.onEntrySelect?.(option),
  });

  const filteredEventRecords = createMemo(() => {
    const filter = selectors.eventsContractFilter();
    const records = props.eventRecords ?? [];
    return filter === null ? records : records.filter((record) => record.contract === filter);
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
    onNetworkAction: (action, option) => {
      void runNetworkSelectorAction(action, option);
    },
  });
  const panelTitle = (panel: DevPanel) => iconLabel(panelIcons[panel], t(panelKeys[panel]));
  const isWide = () => dimensions().width >= 70;
  const useTallStatusBar = () => dimensions().height >= 24;
  const topStatusBarHeight = () => Math.min(
    Math.max(3, dimensions().height - 10),
    statusBarPreferredHeight({
      width: dimensions().width,
      network: selectors.activeNetwork(),
      account: selectors.activeAccount(),
      compact: !useTallStatusBar(),
      ...(props.accountStatus === undefined ? {} : { accountStatus: props.accountStatus }),
      translate: t,
    }),
  );
  const selectorRect = () => {
    const rect = centeredModalRect({
      viewportWidth: dimensions().width,
      viewportHeight: dimensions().height,
      widthRatio: dimensions().width >= 100 ? 0.9 : 0.78,
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
    minHeight: 14,
    maxWidth: 72,
    maxHeight: 16,
  });
  const focusPanel = (panel: DevWorkspacePanel) => { setFocusedPanel(panel); };
  createEffect(() => {
    if (!basePanels.includes(focusedPanel())) {
      setFocusedPanel("contract");
    }
  });
  const nextPanel = (direction: 1 | -1) => {
    const panels = basePanels;
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
  const requestTransactionTrace = (record: DevTransactionRecord | undefined) => {
    if (record?.txHash != null && record.txHash.length > 0) {
      props.onRequestTrace?.(record.txHash);
    }
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
    const sourceFile = selectedSourceFile();
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
  const sourceTargetSelectionPending = () => props.sourceTargetSelectionPending === true;
  const selectedSourceFile = () => {
    const session = props.session;
    if (session === undefined) {
      return null;
    }

    return session.sourceTargets[selectedSourceTargetIndex()]?.sourceFile ?? displaySourceFile(session);
  };
  const activeFunctionList = () => activeDeployedContract()?.functions ?? [];
  const contractPanelFooter = () => {
    const candidates = activeFunctionList().length === 0
      ? [
          t("tui.panel.contract.emptyFooter"),
          t("tui.panel.contract.emptyFooter.compact"),
          t("tui.panel.contract.emptyFooter.keys"),
        ]
      : [
          t("tui.panel.contract.footer"),
          t("tui.panel.contract.footer.compact"),
          t("tui.panel.contract.footer.keys"),
        ];
    return candidates.find((candidate) =>
      terminalCellWidth(candidate) <= contractPanelContentWidth()
    )
      ?? candidates.at(-1)
      ?? "";
  };
  const functionTools = createFunctionToolsState({
    functions: activeFunctionList,
    selectedFunctionIndex,
    setSelectedFunctionIndex,
    scopeKey: () => activeDeployedContract()?.id,
    focusContractPanel: () => focusPanel("contract"),
    copyText: (value) => props.onCopyText?.(value),
    translate: t,
  });
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
  createEffect(() => {
    const session = props.session;
    const sessionKey =
      session === undefined
        ? "none"
        : `${session.projectRoot}\u0000${session.target}\u0000${session.contract}\u0000${session.sourceFile ?? ""}\u0000${session.artifactPath}\u0000${session.sourceTargets.length}`;
    if (sessionKey === syncedSessionKey) {
      return;
    }

    syncedSessionKey = sessionKey;
    setSelectedSourceTargetIndex(initialSourceTargetIndex(session));
    setSelectedFunctionIndex(0);
  });

  createEffect(() => {
    props.onRuntimeSelectionChange?.(runtimeSelection());
  });
  createEffect(() => {
    const snapshot = settingsSnapshot();
    setDraftLanguage(snapshot.language);
    setDraftShowRawStateValues(snapshot.showRawStateValues);
  });
  createEffect(() => {
    const count = activeFunctionList().length;
    if (count === 0) {
      setSelectedFunctionIndex(0);
      functionTools.closeMenu();
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
    if (sourceTargetSelectionPending()) {
      return;
    }

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
    if (action !== null) {
      functionTools.closeMenu();
      props.onDevAction?.(action);
    }
  };
  const openSelectedFunctionInput = () => {
    openFunctionInputAtIndex(selectedFunctionIndex());
  };
  const openDeployInput = (deployAction: "deploy" | "redeploy") => {
    if (sourceTargetSelectionPending()) {
      return;
    }

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
  async function runNetworkSelectorAction(action: SelectorAction, option: SelectorOption): Promise<void> {
    if (action === "startChain") {
      await props.onLocalChainAction?.({ action: "start", networkName: option.name });
      return;
    }
    if (action === "resetChain") {
      await props.onLocalChainAction?.({ action: "reset", networkName: option.name });
      return;
    }
    if (action === "saveChainState") {
      setChainStateSaveDraft({ networkName: option.name, name: "" });
      return;
    }
    if (action === "restoreChainState") {
      const states = await props.onChainStatesRequest?.(option.name) ?? [];
      setChainStatePicker({ networkName: option.name, states, query: "", selectedIndex: 0 });
    }
  }
  const submitChainStateSave = async () => {
    const draft = chainStateSaveDraft();
    if (draft === null) {
      return;
    }

    const name = draft.name.trim();
    if (name.length === 0) {
      setChainStateSaveDraft({ ...draft, error: t("tui.chainState.save.nameRequired") });
      return;
    }

    try {
      await props.onLocalChainAction?.({ action: "save_state", networkName: draft.networkName, stateName: name });
      setChainStateSaveDraft(null);
    } catch (error) {
      setChainStateSaveDraft({ ...draft, error: error instanceof Error ? error.message : String(error) });
    }
  };
  const chainStateOptions = (): readonly SelectorOption[] => {
    const picker = chainStatePicker();
    if (picker === null) {
      return [];
    }

    return fuzzyFilter(picker.states.map(chainStateOption), picker.query);
  };
  const updateChainStateQuery = (query: string) => {
    setChainStatePicker((picker) => picker === null ? null : { ...picker, query, selectedIndex: 0 });
  };
  const moveChainStateSelection = (direction: 1 | -1) => {
    const count = chainStateOptions().length;
    if (count === 0) {
      return;
    }
    setChainStatePicker((picker) =>
      picker === null
        ? null
        : { ...picker, selectedIndex: (picker.selectedIndex + direction + count) % count },
    );
  };
  const restoreChainStateAtIndex = async (index: number) => {
    const picker = chainStatePicker();
    const option = chainStateOptions()[index];
    if (picker === null || option === undefined || option.name === "empty") {
      return;
    }

    await props.onLocalChainAction?.({ action: "restore_state", networkName: picker.networkName, stateName: option.name });
    setChainStatePicker(null);
  };
  const selectSourceTarget = (index: number) => {
    if (sourceTargetSelectionPending()) {
      return;
    }

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
    const result = props.onStateKeyBookChange?.(change, { networkName: selectors.activeNetwork().name });
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
  const runStateKeyBookAction = (action: StateKeyBookAction | undefined) => {
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
  const runSelectedStateKeyBookAction = () => {
    runStateKeyBookAction(stateKeyBookActions()[stateKeyBookActionIndex() ?? 0]);
  };
  const selectStateKeyBookEntry = (index: number) => {
    if (filteredStateKeyBookEntries().length === 0 || index === stateKeyBookSelectedIndex()) {
      setStateKeyBookActionIndex(0);
      return;
    }
    setStateKeyBookSelectedIndex(index);
    setStateKeyBookActionIndex(null);
  };
  const runStateKeyBookActionAtIndex = (index: number) => {
    runStateKeyBookAction(stateKeyBookActions()[index]);
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
  const cycleDraftLanguage = (direction: 1 | -1) => {
    const current = draftLanguage();
    const index = languagePreferences.indexOf(current);
    setDraftLanguage(languagePreferences[(index + direction + languagePreferences.length) % languagePreferences.length] ?? "system");
  };
  const syncSettingsDrafts = () => {
    setDraftLanguage(settingsSnapshot().language);
    setDraftShowRawStateValues(settingsSnapshot().showRawStateValues);
  };
  const saveSettingsSection = (section: SettingsSection) => {
    if (section === "language") {
      selectLanguagePreference(draftLanguage());
    } else {
      selectShowRawStateValues(draftShowRawStateValues());
    }
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
    if (props.traceText !== undefined && props.traceText !== null) {
      if (key.name === "escape" || key.name === "q") {
        key.preventDefault();
        key.stopPropagation();
        props.onCloseTrace?.();
      }
      return;
    }
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
      if (isPlainKey(key, "t")) {
        key.preventDefault();
        key.stopPropagation();
        const record = transactionDetailRecord();
        if (record !== undefined && record.txHash !== null && record.txHash.length > 0) {
          requestTransactionTrace(record);
        }
        return;
      }

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

    if (functionTools.handleKey(key)) {
      return;
    }

    if (chainStateSaveDraft() !== null) {
      if (key.name === "escape") {
        key.preventDefault();
        key.stopPropagation();
        setChainStateSaveDraft(null);
        return;
      }
      if (isEnterKey(key)) {
        key.preventDefault();
        key.stopPropagation();
        void submitChainStateSave();
        return;
      }
      if (key.name === "backspace") {
        key.preventDefault();
        key.stopPropagation();
        setChainStateSaveDraft((draft) => draft === null ? null : { networkName: draft.networkName, name: draft.name.slice(0, -1) });
        return;
      }
      if (key.sequence !== undefined && key.sequence.length === 1 && key.sequence >= " ") {
        key.preventDefault();
        key.stopPropagation();
        setChainStateSaveDraft((draft) => draft === null ? null : { networkName: draft.networkName, name: `${draft.name}${key.sequence}` });
      }
      return;
    }

    if (chainStatePicker() !== null) {
      if (key.name === "escape") {
        key.preventDefault();
        key.stopPropagation();
        setChainStatePicker(null);
        return;
      }
      if (key.name === "down") {
        key.preventDefault();
        key.stopPropagation();
        moveChainStateSelection(1);
        return;
      }
      if (key.name === "up") {
        key.preventDefault();
        key.stopPropagation();
        moveChainStateSelection(-1);
        return;
      }
      if (isEnterKey(key)) {
        key.preventDefault();
        key.stopPropagation();
        void restoreChainStateAtIndex(chainStatePicker()?.selectedIndex ?? 0);
        return;
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

      if (isPlainKey(key, "y")) {
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

      if (key.ctrl === true && key.name === "u") {
        key.preventDefault();
        key.stopPropagation();
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

      if (isPlainKey(key, "t")) {
        key.preventDefault();
        key.stopPropagation();
        requestTransactionTrace(props.transactions?.[selectedTransactionIndex()]);
        return;
      }

      return;
    }

    if (activeTopTab() === "events") {
      if (isPlainKey(key, "c")) {
        key.preventDefault();
        key.stopPropagation();
        openSelector("events-filter");
        return;
      }
      const count = filteredEventRecords().length;
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
        } else {
          setDraftShowRawStateValues((value) => !value);
        }
        return;
      }

      if (isEnterKey(key)) {
        key.preventDefault();
        key.stopPropagation();
        saveSettingsSection(selectedSettingsSection());
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

    if (focusedPanel() === "contract" && isPlainKey(key, "i")) {
      key.preventDefault();
      key.stopPropagation();
      functionTools.openAtIndex(selectedFunctionIndex());
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

  const devPaneTitle = (panel: DevWorkspacePanel): string =>
    panel === "contract" ? iconLabel(nerdIcon.contract, contractPanelTitle(props.session, t)) : panelTitle(panel);
  const devPanes = (): readonly ResponsivePane<DevWorkspacePanel>[] => basePanels.map((panel) => ({ id: panel, label: devPaneTitle(panel) }));

  const renderDevPane = (panel: DevWorkspacePanel, layout: { readonly wide: boolean; readonly stacked: boolean; readonly showTitle?: boolean }): JSX.Element => {
    if (panel === "contract") {
      return (
        <PanelBox
          panel="contract"
          focused={focusedPanel() === "contract"}
          title={layout.showTitle === false ? "" : devPaneTitle("contract")}
          bottomTitle={contractPanelFooter()}
          wide={layout.wide}
          stacked={layout.stacked}
          onFocus={() => focusPanel("contract")}
        >
          <ContractDetails
            session={props.session}
            {...(props.stateSnapshot === undefined ? {} : { stateSnapshot: props.stateSnapshot })}
            fallback={t("tx.preview.title")}
            translate={t}
            contentWidth={contractPanelContentWidth()}
            contentHeight={dimensions().height}
            selectedSourceFile={selectedSourceFile()}
            selectedFunctionIndex={selectedFunctionIndex()}
            selectedSourceTargetIndex={selectedSourceTargetIndex()}
            activeDeployedContract={activeDeployedContract()}
            onFunctionSelect={(index) => { focusPanel("contract"); setSelectedFunctionIndex(index); }}
            onFunctionOpen={(index) => { focusPanel("contract"); setSelectedFunctionIndex(index); openFunctionInputAtIndex(index); }}
            onFunctionToolsOpen={functionTools.openAtIndex}
            onSourceTargetSelect={selectSourceTarget}
            onFilePickerOpen={openFileSelector}
            onDeployedPickerOpen={() => openSelector("deployed")}
          />
        </PanelBox>
      );
    }

    if (panel === "state") {
      return (
        <PanelBox
          panel="state"
          focused={focusedPanel() === "state"}
          title={layout.showTitle === false ? "" : devPaneTitle("state")}
          bottomTitle={t("tui.panel.state.footer")}
          wide={layout.wide}
          stacked={layout.stacked}
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
            onRowOpen={(index) => {
              selectStateRow(index);
              openSelectedStateRowDetail();
            }}
          />
        </PanelBox>
      );
    }

    return (
      <PanelBox
        panel="feed"
        focused={focusedPanel() === "feed"}
        title={layout.showTitle === false ? "" : devPaneTitle("feed")}
        {...(props.feedEntries === undefined ? { body: t("tui.feed.empty") } : {})}
        wide={layout.wide}
        stacked={layout.stacked}
        onFocus={() => focusPanel("feed")}
        onScroll={() => {
          focusPanel("feed");
        }}
      >
        {props.feedEntries === undefined ? undefined : <FeedScroll entries={props.feedEntries} />}
      </PanelBox>
    );
  };

  const renderWideDevPanes = (): JSX.Element => (
    <box flexGrow={1} flexDirection="row" columnGap={theme.space.panelGap} rowGap={0}>
      {renderDevPane("contract", { wide: true, stacked: false })}
      <box flexGrow={0} width="50%" height="100%" flexDirection="column" rowGap={0}>
        {renderDevPane("state", { wide: true, stacked: true })}
        {renderDevPane("feed", { wide: true, stacked: true })}
      </box>
    </box>
  );

  return (
    <box width="100%" height="100%" flexDirection="column" padding={0} rowGap={0}>
      <box border borderStyle="rounded" height={topStatusBarHeight()} title={iconLabel(nerdIcon.app, t("app.name"))} bottomTitle={t("tui.status.actions")} bottomTitleAlignment="right" borderColor={theme.color.statusBorder}>
        <StatusBar
          network={selectors.activeNetwork()}
          account={selectors.activeAccount()}
          compact={!useTallStatusBar()}
          {...(props.accountStatus === undefined ? {} : { accountStatus: props.accountStatus })}
          translate={t}
          onNetworkSelect={() => openSelector("network")}
          onAccountSelect={() => openSelector("account")}
        />
      </box>
      <WorkspaceBar
        tabs={topTabs.map((tab) => ({ id: tab, label: iconLabel(topTabIcons[tab], t(topTabKeys[tab])) }))}
        activeTab={activeTopTab()}
        title={t("tui.workspace.title")}
        switchHint={t("tui.workspace.switchHint")}
        onChange={(tab) => {
          setActiveTopTab(tab);
        }}
      />
      {activeTopTab() === "dev" ? (
        <ResponsivePanelGroup
          panes={devPanes()} activePane={focusedPanel()} wide={isWide()} onPaneSelect={focusPanel} renderWide={renderWideDevPanes}
          renderPane={(pane) => renderDevPane(pane, { wide: false, stacked: true, showTitle: false })}
        />
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
        <TopTabPanel
          title={
            selectors.eventsContractFilter() === null
              ? t("tui.tab.events")
              : `${t("tui.tab.events")} · ${t("tui.events.filterLabel", { contract: selectors.eventsContractFilter() ?? "" })}`
          }
          bottomTitle={t("tui.events.footer")}
          focused
        >
          <EventsDetails
            records={filteredEventRecords()}
            fallback={t("tui.events.empty")}
            translate={t}
            selectedIndex={selectedEventIndex()}
            activeDeployedContract={activeDeployedContract()}
            onRecordSelect={setSelectedEventIndex}
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
            message={settingsMessage()}
            translate={t}
            onSettingSelect={(section) => {
              setSelectedSettingsIndex(settingsSections.indexOf(section));
            }}
            onDraftLanguageSelect={setDraftLanguage}
            onDraftShowRawStateValuesSelect={setDraftShowRawStateValues}
          />
        </TopTabPanel>
      )}
      <DevSelectorLayer
        selector={selectors.activeSelector()}
        preview={dimensions().width >= 100}
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
        onActionSelect={selectorActionMenu.runActionAtIndex}
      />
      <FunctionToolsLayer
        menuIndex={functionTools.menuIndex()}
        detailItem={functionTools.detailItem()}
        translate={t}
        rect={actionModalRect()}
        onToolSelect={functionTools.run}
      />
      <Show when={chainStateSaveDraft()}>
        {(draft: Accessor<ChainStateSaveDraft>) => (
          <ChainStateSaveModal
            rect={actionModalRect()}
            translate={t}
            name={draft().name}
            {...(draft().error === undefined ? {} : { error: draft().error })}
            onNameChange={(name) => {
              setChainStateSaveDraft({ networkName: draft().networkName, name });
            }}
            onSubmit={() => {
              void submitChainStateSave();
            }}
          />
        )}
      </Show>
      <Show when={chainStatePicker()}>
        {(picker: Accessor<ChainStatePickerState>) => (
          <ChainStatePickerModal
            rect={actionModalRect()}
            translate={t}
            query={picker().query}
            options={chainStateOptions()}
            selectedIndex={Math.min(picker().selectedIndex, Math.max(0, chainStateOptions().length - 1))}
            onQueryChange={updateChainStateQuery}
            onSelect={(index) => {
              void restoreChainStateAtIndex(index);
            }}
          />
        )}
      </Show>
      {shortcutsVisible() ? (
        <ShortcutOverlay translate={t} rect={shortcutRect()} />
      ) : null}
      {exitConfirmVisible() ? (
        <ExitConfirmModal translate={t} rect={shortcutRect()} />
      ) : null}
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
      <Show when={props.traceText !== undefined && props.traceText !== null}>
        <TraceModal trace={props.traceText ?? ""} translate={t} rect={actionModalRect()} />
      </Show>
      <Show when={transactionDetailRecord()}>
        {(record: Accessor<DevTransactionRecord>) => (
          <TransactionDetailModal
            record={record()}
            translate={t}
            rect={actionModalRect()}
          />
        )}
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
            onEntrySelect={selectStateKeyBookEntry}
            onActionSelect={runStateKeyBookActionAtIndex}
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
            onFieldFocus={(activeField) => updateStateKeyBookDraft({ activeField })}
            onSubmit={submitStateKeyBookDraft}
          />
        )}
      </Show>
    </box>
  );
}
