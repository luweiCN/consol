import type { ConsolEvent, TxPreviewEvent } from "@consol/protocol";
import type { FunctionItem } from "./project";
import {
  clearActiveField,
  emptyArgumentTexts,
  initialFunctionInputField,
  recallHistory,
  txPreviewEventWithGasLimit,
  txPreviewGasLimitText,
} from "./dev-state-helpers";

const MAX_DEV_FEED_EVENTS = 100;

export type DevPanel = "files" | "contract" | "state" | "feed" | "diagnostics";
export type DevFunctionInputField =
  | { readonly kind: "argument"; readonly index: number }
  | { readonly kind: "value" }
  | { readonly kind: "gasLimit" };
export type DevFunctionInputAction = "read" | "deploy" | "redeploy" | "send";
export type DevGasLimitMode = "auto" | "custom";
export type DevFunctionInputGasLimitMode = DevGasLimitMode;

export type DevFunctionInputValues = {
  readonly argumentTexts: readonly string[];
  readonly valueText: string;
  readonly gasLimitText: string;
  readonly gasLimitMode: DevFunctionInputGasLimitMode;
};

export type DevFunctionInputDraft = {
  readonly action: DevFunctionInputAction;
  readonly function: FunctionItem;
  readonly argumentTexts: readonly string[];
  readonly valueText: string;
  readonly gasLimitText: string;
  readonly gasLimitMode: DevFunctionInputGasLimitMode;
  readonly activeField: DevFunctionInputField;
  readonly history: readonly DevFunctionInputValues[];
  readonly historyIndex: number | null;
  readonly accountName?: string;
  readonly networkName?: string;
  readonly targetOverride?: string;
  readonly contractOverride?: string;
  readonly addressOverride?: string;
  readonly cwdOverride?: string;
};

export type DevModal =
  | { readonly type: "none" }
  | { readonly type: "functionInput"; readonly draft: DevFunctionInputDraft }
  | {
      readonly type: "txPreview";
      readonly event: TxPreviewEvent;
      readonly gasLimitMode: DevGasLimitMode;
      readonly gasLimitText: string;
    };

export type DevState = {
  readonly activePanel: DevPanel;
  readonly modal: DevModal;
  readonly modalStack: readonly DevModal[];
  readonly confirmedTxPreview: TxPreviewEvent | null;
  readonly submittedFunction: {
    readonly function: FunctionItem;
    readonly action: DevFunctionInputAction;
    readonly accountName?: string;
    readonly networkName?: string;
    readonly targetOverride?: string;
    readonly contractOverride?: string;
    readonly addressOverride?: string;
    readonly cwdOverride?: string;
  } | null;
  readonly selectedSourceTarget: { readonly sourceFile: string; readonly target: string } | null;
  readonly feed: readonly ConsolEvent[];
};

export type DevAction =
  | {
      readonly type: "openFunctionInput";
      readonly function: FunctionItem;
      readonly action?: DevFunctionInputAction;
      readonly history?: readonly DevFunctionInputValues[];
      readonly accountName?: string;
      readonly networkName?: string;
      readonly targetOverride?: string;
      readonly contractOverride?: string;
      readonly addressOverride?: string;
      readonly cwdOverride?: string;
    }
  | {
      readonly type: "submitFunction";
      readonly function: FunctionItem;
      readonly action: DevFunctionInputAction;
      readonly accountName?: string;
      readonly networkName?: string;
      readonly targetOverride?: string;
      readonly contractOverride?: string;
      readonly addressOverride?: string;
      readonly cwdOverride?: string;
    }
  | { readonly type: "updateFunctionInputArgument"; readonly index: number; readonly value: string }
  | { readonly type: "updateFunctionInputValue"; readonly value: string }
  | { readonly type: "updateFunctionInputGasLimit"; readonly value: string }
  | { readonly type: "updateFunctionInputGasLimitMode"; readonly mode: DevFunctionInputGasLimitMode }
  | { readonly type: "clearActiveFunctionInputField" }
  | { readonly type: "recallFunctionInputHistory"; readonly direction: 1 | -1 }
  | { readonly type: "focusFunctionInputField"; readonly field: DevFunctionInputField }
  | { readonly type: "openDeployPreview"; readonly event: TxPreviewEvent }
  | { readonly type: "updateTxPreviewGasLimit"; readonly value: string }
  | { readonly type: "updateTxPreviewGasLimitMode"; readonly mode: DevGasLimitMode }
  | { readonly type: "confirmTxPreview"; readonly previewId: string }
  | { readonly type: "cancelModal" }
  | { readonly type: "focusPanel"; readonly panel: DevPanel }
  | { readonly type: "selectSourceTarget"; readonly sourceFile: string; readonly target: string };

export function createInitialDevState(): DevState {
  return {
    activePanel: "contract",
    modal: { type: "none" },
    modalStack: [],
    confirmedTxPreview: null,
    submittedFunction: null,
    selectedSourceTarget: null,
    feed: [],
  };
}

export function devReducer(state: DevState, action: DevAction): DevState {
  switch (action.type) {
    case "openFunctionInput":
      return {
        ...state,
        submittedFunction: null,
        modalStack: [],
        modal: {
          type: "functionInput",
          draft: {
            action: action.action ?? "send",
            function: action.function,
            argumentTexts: emptyArgumentTexts(action.function),
            valueText: "",
            gasLimitText: "",
            gasLimitMode: "auto",
            activeField: initialFunctionInputField(action.function),
            history: action.history ?? [],
            historyIndex: null,
            ...(action.accountName === undefined ? {} : { accountName: action.accountName }),
            ...(action.networkName === undefined ? {} : { networkName: action.networkName }),
            ...(action.targetOverride === undefined ? {} : { targetOverride: action.targetOverride }),
            ...(action.contractOverride === undefined ? {} : { contractOverride: action.contractOverride }),
            ...(action.addressOverride === undefined ? {} : { addressOverride: action.addressOverride }),
            ...(action.cwdOverride === undefined ? {} : { cwdOverride: action.cwdOverride }),
          },
        },
      };
    case "submitFunction":
      return {
        ...state,
        modal: { type: "none" },
        modalStack: [],
        submittedFunction: {
          function: action.function,
          action: action.action,
          ...(action.accountName === undefined ? {} : { accountName: action.accountName }),
          ...(action.networkName === undefined ? {} : { networkName: action.networkName }),
          ...(action.targetOverride === undefined ? {} : { targetOverride: action.targetOverride }),
          ...(action.contractOverride === undefined ? {} : { contractOverride: action.contractOverride }),
          ...(action.addressOverride === undefined ? {} : { addressOverride: action.addressOverride }),
          ...(action.cwdOverride === undefined ? {} : { cwdOverride: action.cwdOverride }),
        },
      };
    case "updateFunctionInputArgument":
      if (state.modal.type !== "functionInput") {
        return state;
      }

      return {
        ...state,
        modal: {
          type: "functionInput",
          draft: {
            ...state.modal.draft,
            argumentTexts: state.modal.draft.argumentTexts.map((value, index) => index === action.index ? action.value : value),
            historyIndex: null,
          },
        },
      };
    case "updateFunctionInputValue":
      if (state.modal.type !== "functionInput") {
        return state;
      }

      return {
        ...state,
        modal: {
          type: "functionInput",
          draft: {
            ...state.modal.draft,
            valueText: action.value,
            historyIndex: null,
          },
        },
      };
    case "updateFunctionInputGasLimit":
      if (state.modal.type !== "functionInput") {
        return state;
      }

      return {
        ...state,
        modal: {
          type: "functionInput",
          draft: {
            ...state.modal.draft,
            gasLimitText: action.value,
            historyIndex: null,
          },
        },
      };
    case "updateFunctionInputGasLimitMode":
      if (state.modal.type !== "functionInput") {
        return state;
      }

      return {
        ...state,
        modal: {
          type: "functionInput",
          draft: {
            ...state.modal.draft,
            gasLimitMode: action.mode,
            historyIndex: null,
          },
        },
      };
    case "clearActiveFunctionInputField":
      if (state.modal.type !== "functionInput") {
        return state;
      }

      return {
        ...state,
        modal: {
          type: "functionInput",
          draft: clearActiveField(state.modal.draft),
        },
      };
    case "recallFunctionInputHistory":
      if (state.modal.type !== "functionInput") {
        return state;
      }

      return {
        ...state,
        modal: {
          type: "functionInput",
          draft: recallHistory(state.modal.draft, action.direction),
        },
      };
    case "focusFunctionInputField":
      if (state.modal.type !== "functionInput") {
        return state;
      }

      return {
        ...state,
        modal: {
          type: "functionInput",
          draft: {
            ...state.modal.draft,
            activeField: action.field,
            historyIndex: null,
          },
        },
      };
    case "openDeployPreview":
      {
        const gasLimit = txPreviewGasLimitText(action.event);
        return {
          ...state,
          modal: {
            type: "txPreview",
            event: action.event,
            gasLimitMode: gasLimit === "" ? "auto" : "custom",
            gasLimitText: gasLimit,
          },
          modalStack: state.modal.type === "none" ? state.modalStack : [...state.modalStack, state.modal],
          confirmedTxPreview: null,
          submittedFunction: null,
          feed: [...state.feed, action.event].slice(-MAX_DEV_FEED_EVENTS),
        };
      }
    case "updateTxPreviewGasLimit":
      if (state.modal.type !== "txPreview") {
        return state;
      }

      return {
        ...state,
        modal: {
          ...state.modal,
          gasLimitText: action.value,
        },
      };
    case "updateTxPreviewGasLimitMode":
      if (state.modal.type !== "txPreview") {
        return state;
      }

      return {
        ...state,
        modal: {
          ...state.modal,
          gasLimitMode: action.mode,
        },
      };
    case "confirmTxPreview":
      if (state.modal.type !== "txPreview" || state.modal.event.id !== action.previewId) {
        return state;
      }

      return {
        ...state,
        modal: { type: "none" },
        modalStack: [],
        confirmedTxPreview: txPreviewEventWithGasLimit(state.modal),
      };
    case "cancelModal":
      if (state.modalStack.length > 0) {
        const previous = state.modalStack[state.modalStack.length - 1] ?? { type: "none" };
        return {
          ...state,
          modal: previous,
          modalStack: state.modalStack.slice(0, -1),
        };
      }

      return {
        ...state,
        modal: { type: "none" },
        modalStack: [],
      };
    case "focusPanel":
      return {
        ...state,
        activePanel: action.panel,
      };
    case "selectSourceTarget":
      return {
        ...state,
        selectedSourceTarget: {
          sourceFile: action.sourceFile,
          target: action.target,
        },
      };
    default: {
      const exhaustive: never = action;
      throw new Error(`unhandled dev action: ${JSON.stringify(exhaustive)}`);
    }
  }
}
