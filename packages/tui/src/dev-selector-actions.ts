import type { MessageKey } from "@consol/i18n";
import { createEffect, createSignal, type Accessor, type Setter } from "solid-js";
import type { ActiveSelector } from "./DevSelectorLayer";
import { accountAddressFromOption, fullAddressFromText } from "./DevStatusBar";
import type { PickerActionOption } from "./PickerActionMenu";
import type { SelectorOption } from "./SelectorModal";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;
type SelectorAction = "select" | "copyAddress" | "deleteDeployed" | "addPastedAddress";

export type DevSelectorActionsInput = {
  readonly activeSelector: Accessor<ActiveSelector>;
  readonly filteredOptions: Accessor<readonly SelectorOption[]>;
  readonly activeDeployedContractId: Accessor<string | null>;
  readonly setActiveDeployedContractId: Setter<string | null>;
  readonly translate: Translate;
  readonly selectOption: (index: number) => void;
  readonly closeSelector: () => void;
  readonly updateSelectorQuery: (query: string) => void;
  readonly onCopyText?: (text: string) => void;
  readonly onDeployedContractAdd?: (address: string) => string | void;
  readonly onDeployedContractRemove?: (id: string) => void;
};

export function createDevSelectorActions(input: DevSelectorActionsInput) {
  const [actionIndex, setActionIndex] = createSignal<number | null>(null);
  const selectedOption = () => {
    const selector = input.activeSelector();
    return selector.kind === "none" ? undefined : input.filteredOptions()[selector.selectedIndex];
  };
  const actions = (): readonly SelectorAction[] => {
    const selector = input.activeSelector();
    if (selector.kind === "none") {
      return [];
    }

    const option = selectedOption();
    if (selector.kind === "deployed" && option === undefined) {
      return fullAddressFromText(selector.query) === null ? [] : ["addPastedAddress"];
    }
    if (option === undefined) {
      return [];
    }

    const result: SelectorAction[] = ["select"];
    if ((selector.kind === "account" || selector.kind === "deployed") && accountAddressFromOption(option) !== null) {
      result.push("copyAddress");
    }
    if (selector.kind === "deployed") {
      result.push("deleteDeployed");
    }
    return result;
  };
  const close = () => {
    setActionIndex(null);
    input.closeSelector();
  };
  const addPastedDeployedContract = () => {
    const selector = input.activeSelector();
    if (selector.kind !== "deployed") {
      return;
    }

    const address = fullAddressFromText(selector.query);
    if (address === null) {
      return;
    }

    const id = input.onDeployedContractAdd?.(address);
    if (typeof id === "string") {
      input.setActiveDeployedContractId(id);
    }
    close();
  };
  const selectActiveOption = () => {
    const selector = input.activeSelector();
    if (selector.kind === "none") {
      return;
    }
    if (selector.kind === "deployed" && selectedOption() === undefined) {
      addPastedDeployedContract();
      return;
    }

    setActionIndex(null);
    input.selectOption(selector.selectedIndex);
  };
  const copySelectedAddress = () => {
    const address = accountAddressFromOption(selectedOption());
    if (address !== null) {
      input.onCopyText?.(address);
    }
    setActionIndex(null);
  };
  const deleteSelectedDeployedContract = () => {
    const selector = input.activeSelector();
    const option = selectedOption();
    if (selector.kind !== "deployed" || option === undefined) {
      return;
    }

    input.onDeployedContractRemove?.(option.name);
    if (option.name === input.activeDeployedContractId()) {
      input.setActiveDeployedContractId(null);
    }
    close();
  };
  const actionLabel = (action: SelectorAction): string => {
    if (action === "copyAddress") {
      return input.translate("tui.picker.copyAddress");
    }
    if (action === "deleteDeployed") {
      return input.translate("tui.picker.delete");
    }
    if (action === "addPastedAddress") {
      return input.translate("tui.picker.addPastedAddress");
    }
    return input.translate("tui.picker.select");
  };

  createEffect(() => {
    if (input.activeSelector().kind === "none") {
      setActionIndex(null);
    }
  });

  return {
    actionIndex,
    actionOptions: (): readonly PickerActionOption[] => {
      const group = input.translate("tui.picker.currentItem");
      return actions().map((action) => ({
        id: action,
        label: actionLabel(action),
        group,
        ...(action === "deleteDeployed" ? { danger: true } : {}),
      }));
    },
    close,
    reset: () => {
      setActionIndex(null);
    },
    updateQuery: (query: string) => {
      setActionIndex(null);
      input.updateSelectorQuery(query);
    },
    openMenu: () => {
      if (actions().length > 0) {
        setActionIndex(0);
      }
    },
    moveAction: (direction: 1 | -1) => {
      setActionIndex((index) => {
        if (index === null) {
          return null;
        }
        const count = actions().length;
        return count === 0 ? null : (index + direction + count) % count;
      });
    },
    runSelectedAction: () => {
      const action = actions()[actionIndex() ?? 0];
      if (action === "select") {
        selectActiveOption();
      } else if (action === "copyAddress") {
        copySelectedAddress();
      } else if (action === "deleteDeployed") {
        deleteSelectedDeployedContract();
      } else if (action === "addPastedAddress") {
        addPastedDeployedContract();
      }
    },
    selectActiveOption,
    copySelectedAddress,
    deleteSelectedDeployedContract,
  };
}
