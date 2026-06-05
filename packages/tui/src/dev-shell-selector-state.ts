import type { DevAction, DevSession } from "@consol/core";
import type { Locale } from "@consol/i18n";
import { createMemo, createSignal, type Accessor, type Setter } from "solid-js";
import type { ActiveSelector, DevAccountOption, DevNetworkOption, SelectorKind } from "./DevSelectorLayer";
import { fuzzyFilter } from "./fuzzy";
import type { DevAccountStatusSnapshot, DevDeployedContract, SourcePreview } from "./runtime-types";
import type { SelectorOption } from "./SelectorModal";
import {
  deployedDetailParts,
  deployedPreviewInfoRows,
  deployedPreviewLines,
  deployedTitleParts,
  enrichAccountOptions,
  selectorOpeners,
  sourceFileGroups,
  sourceTargetIndexForOption,
  uniqueDeployedContracts,
} from "./dev-selector-options";

const defaultNetworkOption: SelectorOption = { name: "local", label: "local #31337 / anvil / local", active: true };
const defaultAccountOption: SelectorOption = { name: "anvil0", label: "anvil0 / 0xf39f...2266 / anvil-index", active: true };
const defaultNetworkOptions: readonly SelectorOption[] = [defaultNetworkOption];
const defaultAccountOptions: readonly SelectorOption[] = [defaultAccountOption];

export type DevShellSelectorStateInput = {
  readonly session: Accessor<DevSession | undefined>;
  readonly networkOptions: Accessor<readonly DevNetworkOption[] | undefined>;
  readonly accountOptions: Accessor<readonly DevAccountOption[] | undefined>;
  readonly accountStatus: Accessor<DevAccountStatusSnapshot | undefined>;
  readonly entryOptions: Accessor<readonly SelectorOption[] | undefined>;
  readonly sourcePreviews: Accessor<readonly SourcePreview[] | undefined>;
  readonly deployedContracts: Accessor<readonly DevDeployedContract[]>;
  readonly nowUnix: Accessor<number>;
  readonly locale: Accessor<Locale>;
  readonly activeDeployedContractId: Accessor<string | null>;
  readonly setActiveDeployedContractId: Setter<string | null>;
  readonly selectedSourceTargetIndex: Accessor<number>;
  readonly setSelectedSourceTargetIndex: Setter<number>;
  readonly onDevAction: (action: DevAction) => void;
  readonly onEntrySelect: (option: SelectorOption) => void;
};

export function createDevShellSelectorState(input: DevShellSelectorStateInput) {
  const networkOptions = createMemo(() =>
    input.networkOptions() !== undefined && input.networkOptions()?.length !== 0 ? input.networkOptions() ?? [] : defaultNetworkOptions,
  );
  const baseAccountOptions = createMemo(() =>
    input.accountOptions() !== undefined && input.accountOptions()?.length !== 0 ? input.accountOptions() ?? [] : defaultAccountOptions,
  );
  const accountOptions = createMemo(() => enrichAccountOptions(baseAccountOptions(), input.accountStatus()));
  const initialNetwork = createMemo(() => networkOptions().find((option) => option.active) ?? networkOptions()[0]);
  const initialAccount = createMemo(() => baseAccountOptions().find((option) => option.active) ?? baseAccountOptions()[0]);
  const [activeNetworkName, setActiveNetworkName] = createSignal(initialNetwork()?.name ?? "local");
  const [activeAccountName, setActiveAccountName] = createSignal(initialAccount()?.name ?? "anvil0");
  const [activeSelector, setActiveSelector] = createSignal<ActiveSelector>(
    input.session() === undefined && (input.entryOptions()?.length ?? 0) > 0
      ? { kind: "entry", query: "", selectedIndex: 0, ignoreOpenerInput: false }
      : { kind: "none" },
  );
  const activeNetwork = () =>
    networkOptions().find((option) => option.name === activeNetworkName()) ?? initialNetwork() ?? defaultNetworkOption;
  const activeAccount = () =>
    baseAccountOptions().find((option) => option.name === activeAccountName()) ?? initialAccount() ?? defaultAccountOption;
  const sourcePreviewByTarget = createMemo(() => new Map((input.sourcePreviews() ?? []).map((preview) => [preview.target, preview.lines])));
  const deployedOptions = createMemo((): readonly SelectorOption[] =>
    uniqueDeployedContracts(input.deployedContracts()).map((contract) => ({
      name: contract.id,
      label: contract.contract,
      active: contract.id === input.activeDeployedContractId(),
      titleParts: deployedTitleParts(contract, input.nowUnix(), input.locale()),
      detailParts: deployedDetailParts(contract),
      copyValue: contract.address,
      previewInfoRows: deployedPreviewInfoRows(contract),
      previewLines: deployedPreviewLines(contract),
      searchText: `${contract.contract} ${contract.address} ${contract.network ?? ""} ${contract.account ?? ""} ${contract.target}`,
    })),
  );
  const sourceOptions = createMemo((): readonly SelectorOption[] =>
    sourceFileGroups(input.session()?.sourceTargets ?? [], input.selectedSourceTargetIndex()).map((group) => ({
      name: String(group.targetIndex),
      label: group.sourceFile,
      active: group.active,
      meta: group.contracts.length === 1 ? group.contracts[0] ?? "" : `${group.contracts.length} contracts`,
      description: group.contracts.length === 1 ? "" : group.contracts.join(", "),
      previewLines: sourcePreviewByTarget().get(group.sourceFile) ?? sourcePreviewByTarget().get(group.target) ?? [
        group.sourceFile,
        ...group.contracts,
      ],
      searchText: `${group.sourceFile} ${group.contracts.join(" ")} ${group.target}`,
    })) ?? [],
  );
  const entryOptions = createMemo((): readonly SelectorOption[] => input.entryOptions() ?? []);
  const selectorOptions = (kind: SelectorKind) =>
    kind === "network"
      ? networkOptions()
      : kind === "account"
        ? accountOptions()
        : kind === "source"
          ? sourceOptions()
          : kind === "deployed"
            ? deployedOptions()
            : entryOptions();
  const selectorActiveName = (kind: SelectorKind) =>
    kind === "network"
      ? activeNetwork().name
      : kind === "account"
        ? activeAccount().name
        : kind === "source"
          ? String(input.selectedSourceTargetIndex())
          : kind === "deployed"
            ? input.activeDeployedContractId() ?? deployedOptions()[0]?.name ?? ""
            : (entryOptions().find((option) => option.active) ?? entryOptions()[0])?.name ?? "";
  const filteredSelectorOptions = createMemo((): readonly SelectorOption[] => {
    const selector = activeSelector();
    return selector.kind === "none" ? [] : fuzzyFilter(selectorOptions(selector.kind), selector.query);
  });
  const selectorQuery = (kind: SelectorKind) => {
    const selector = activeSelector();
    return selector.kind === kind ? selector.query : "";
  };
  const selectorSelectedIndex = (kind: SelectorKind) => {
    const selector = activeSelector();
    return selector.kind === kind ? selector.selectedIndex : 0;
  };
  const openSelector = (kind: SelectorKind) => {
    const activeIndex = selectorOptions(kind).findIndex((option) => option.name === selectorActiveName(kind));
    setActiveSelector({ kind, query: "", selectedIndex: activeIndex >= 0 ? activeIndex : 0, ignoreOpenerInput: true });
  };
  const updateSelectorQuery = (query: string) => {
    setActiveSelector((selector) => {
      if (selector.kind === "none" || (selector.ignoreOpenerInput && query.length === 0)) {
        return selector;
      }

      const opener = selectorOpeners(selector.kind).find((candidate) => query.toLowerCase().startsWith(candidate));
      if (opener !== undefined && selector.ignoreOpenerInput) {
        const queryWithoutOpener = query.slice(1);
        return { ...selector, query: queryWithoutOpener, selectedIndex: 0, ignoreOpenerInput: queryWithoutOpener.length === 0 };
      }

      return { ...selector, query, selectedIndex: 0, ignoreOpenerInput: false };
    });
  };
  const selectOption = (index: number) => {
    const selector = activeSelector();
    if (selector.kind === "none") {
      return;
    }

    const option = filteredSelectorOptions()[index];
    if (option === undefined) {
      return;
    }

    if (selector.kind === "network") {
      setActiveNetworkName(option.name);
    } else if (selector.kind === "account") {
      setActiveAccountName(option.name);
    } else if (selector.kind === "source") {
      const sourceTargets = input.session()?.sourceTargets ?? [];
      const selectedIndex = sourceTargetIndexForOption(sourceTargets, option, selector.query);
      const sourceTarget = sourceTargets[selectedIndex];
      if (sourceTarget !== undefined) {
        input.setSelectedSourceTargetIndex(selectedIndex);
        input.onDevAction({ type: "selectSourceTarget", sourceFile: sourceTarget.sourceFile, target: sourceTarget.target });
      }
    } else if (selector.kind === "deployed") {
      input.setActiveDeployedContractId(option.name);
    } else {
      input.onEntrySelect(option);
    }

    setActiveSelector({ kind: "none" });
  };
  const moveSelectedOption = (direction: 1 | -1) => {
    const optionCount = filteredSelectorOptions().length;
    if (optionCount === 0) {
      return;
    }

    setActiveSelector((selector) =>
      selector.kind === "none"
        ? selector
        : { ...selector, selectedIndex: (selector.selectedIndex + direction + optionCount) % optionCount },
    );
  };

  return {
    activeAccount,
    activeNetwork,
    activeSelector,
    closeSelector: () => {
      setActiveSelector({ kind: "none" });
    },
    filteredSelectorOptions,
    moveSelectedOption,
    openSelector,
    selectOption,
    selectorQuery,
    selectorSelectedIndex,
    updateSelectorQuery,
  };
}
