import type { TxPreviewEvent } from "@consol/protocol";
import type { FunctionItem } from "./project";
import type {
  DevFunctionInputDraft,
  DevFunctionInputField,
  DevFunctionInputValues,
  DevModal,
} from "./dev-state";

export function initialFunctionInputField(functionItem: FunctionItem): DevFunctionInputField {
  return functionItem.inputs.length > 0 ? { kind: "argument", index: 0 } : { kind: "value" };
}

export function txPreviewGasLimitText(event: TxPreviewEvent): string {
  const value = event.gas.context?.["gasLimit"];
  return value === undefined || value === null ? "" : String(value);
}

export function txPreviewEventWithGasLimit(modal: Extract<DevModal, { readonly type: "txPreview" }>): TxPreviewEvent {
  const context = { ...modal.event.gas.context };
  const gasLimit = modal.gasLimitText.trim();
  if (modal.gasLimitMode === "custom" && gasLimit.length > 0) {
    context["gasLimit"] = gasLimit;
  } else {
    delete context["gasLimit"];
  }

  const gasWithoutContext = { ...modal.event.gas };
  delete gasWithoutContext.context;
  return {
    ...modal.event,
    gas: Object.keys(context).length === 0
      ? gasWithoutContext
      : { ...modal.event.gas, context },
  };
}

export function emptyArgumentTexts(functionItem: FunctionItem): readonly string[] {
  return functionItem.inputs.map(() => "");
}

export function clearActiveField(draft: DevFunctionInputDraft): DevFunctionInputDraft {
  if (draft.activeField.kind === "value") {
    return { ...draft, valueText: "", historyIndex: null };
  }

  if (draft.activeField.kind === "gasLimit") {
    return { ...draft, gasLimitText: "", historyIndex: null };
  }

  const activeIndex = draft.activeField.index;
  return {
    ...draft,
    argumentTexts: draft.argumentTexts.map((value, index) => index === activeIndex ? "" : value),
    historyIndex: null,
  };
}

export function recallHistory(draft: DevFunctionInputDraft, direction: 1 | -1): DevFunctionInputDraft {
  if (draft.history.length === 0) {
    return draft;
  }

  if (draft.historyIndex === null && direction === 1) {
    return clearActiveField(draft);
  }

  const baseIndex = draft.historyIndex ?? draft.history.length;
  const nextIndex = baseIndex + direction;
  if (nextIndex >= draft.history.length) {
    return clearActiveField(draft);
  }

  if (nextIndex < 0) {
    return draft;
  }

  const values = draft.history[nextIndex];
  if (values === undefined) {
    return draft;
  }

  return {
    ...applyActiveHistoryValue(draft, values),
    historyIndex: nextIndex,
  };
}

function applyActiveHistoryValue(draft: DevFunctionInputDraft, values: DevFunctionInputValues): DevFunctionInputDraft {
  if (draft.activeField.kind === "value") {
    return { ...draft, valueText: values.valueText };
  }

  if (draft.activeField.kind === "gasLimit") {
    return { ...draft, gasLimitText: values.gasLimitText, gasLimitMode: values.gasLimitMode };
  }

  const activeIndex = draft.activeField.index;
  return {
    ...draft,
    argumentTexts: draft.argumentTexts.map((value, index) => index === activeIndex ? values.argumentTexts[activeIndex] ?? "" : value),
  };
}
