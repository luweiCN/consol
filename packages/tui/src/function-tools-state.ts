import { functionAbiJson, type FunctionItem } from "@consol/core";
import type { MessageKey } from "@consol/i18n";
import type { KeyEvent } from "@opentui/core";
import { createEffect, createSignal, type Accessor, type Setter } from "solid-js";
import { isEnterKey } from "./dev-keymap";
import { isPlainKey } from "./dev-shell-helpers";
import {
  functionDetailText,
  functionToolActions,
  functionToolCopyValue,
  type FunctionToolAction,
} from "./FunctionTools";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function createFunctionToolsState(input: {
  readonly functions: Accessor<readonly FunctionItem[]>;
  readonly selectedFunctionIndex: Accessor<number>;
  readonly setSelectedFunctionIndex: Setter<number>;
  readonly scopeKey: Accessor<string | null | undefined>;
  readonly focusContractPanel: () => void;
  readonly copyText: (value: string) => void;
  readonly translate: Translate;
}) {
  const [menuIndex, setMenuIndex] = createSignal<number | null>(null);
  const [detailItem, setDetailItem] = createSignal<FunctionItem | null>(null);
  const selectedFunction = () => input.functions()[input.selectedFunctionIndex()];
  const closeMenu = () => setMenuIndex(null);
  const closeDetail = () => setDetailItem(null);
  const reset = () => {
    closeMenu();
    closeDetail();
  };
  let previousScopeKey = input.scopeKey();
  createEffect(() => {
    const scopeKey = input.scopeKey();
    if (scopeKey === previousScopeKey) {
      return;
    }
    previousScopeKey = scopeKey;
    reset();
  });
  const openAtIndex = (index: number) => {
    if (input.functions()[index] === undefined) {
      return;
    }
    input.focusContractPanel();
    input.setSelectedFunctionIndex(index);
    setMenuIndex(0);
  };
  const moveSelection = (direction: 1 | -1) => {
    setMenuIndex((index) => index === null ? null : (index + direction + functionToolActions.length) % functionToolActions.length);
  };
  const run = (action: FunctionToolAction | undefined) => {
    const functionItem = selectedFunction();
    if (action === undefined || functionItem === undefined) {
      closeMenu();
      return;
    }
    if (action === "view") {
      closeMenu();
      setDetailItem(functionItem);
      return;
    }
    const value = functionToolCopyValue(action, functionItem);
    if (value !== null) {
      input.copyText(value);
    }
    closeMenu();
  };
  const copyDetail = () => {
    const functionItem = detailItem();
    if (functionItem !== null) {
      input.copyText(functionDetailText(functionItem, input.translate));
    }
  };
  const copyDetailAbiJson = () => {
    const functionItem = detailItem();
    if (functionItem !== null) {
      input.copyText(functionAbiJson(functionItem));
    }
  };
  const handleKey = (key: KeyEvent): boolean => {
    if (detailItem() !== null) {
      if (isPlainKey(key, "c")) {
        key.preventDefault();
        key.stopPropagation();
        copyDetailAbiJson();
      } else if (isPlainKey(key, "y")) {
        key.preventDefault();
        key.stopPropagation();
        copyDetail();
      } else if (key.name === "escape") {
        key.preventDefault();
        key.stopPropagation();
        closeDetail();
      }
      return true;
    }
    if (menuIndex() === null) {
      return false;
    }
    if (key.name === "up" || key.name === "down") {
      key.preventDefault();
      key.stopPropagation();
      moveSelection(key.name === "down" ? 1 : -1);
    } else if (isEnterKey(key)) {
      key.preventDefault();
      key.stopPropagation();
      run(functionToolActions[menuIndex() ?? 0]);
    } else if (key.name === "escape" || key.name === "left") {
      key.preventDefault();
      key.stopPropagation();
      closeMenu();
    }
    return true;
  };

  return {
    closeMenu,
    detailItem,
    handleKey,
    menuIndex,
    openAtIndex,
    run,
  };
}
