import { describe, expect, test } from "bun:test";
import type { TxPreviewEvent } from "@consol/protocol";
import type { FunctionItem } from "./project";
import {
  createInitialDevState,
  devReducer,
} from "./dev-state";

const previewEvent: TxPreviewEvent = {
  type: "tx.preview",
  id: "preview-1",
  timestamp: "2026-06-03T00:00:00.000Z",
  action: "deploy",
  network: {
    name: "local",
    chainId: 31337,
    fingerprint: "chain:31337:local",
    writePolicy: "local",
  },
  account: {
    name: "anvil0",
    address: "0x0000000000000000000000000000000000000001",
  },
  signer: {
    name: "anvil0",
    source: "anvil-index",
    address: "0x0000000000000000000000000000000000000001",
    available: true,
  },
  target: {
    display: "src/Counter.sol:Counter",
    contract: "Counter",
    sourceMode: "project",
    sourceFile: "src/Counter.sol",
  },
  calldata: {
    function: "constructor",
    signature: "constructor()",
    args: [],
    hex: "0x",
  },
  gas: {
    source: "compiler_estimate",
    estimate: "120000",
    confidence: "medium",
  },
};

const writeFunction: FunctionItem = {
  name: "setNumber",
  signature: "setNumber(uint256)",
  state_mutability: "nonpayable",
  kind: "write",
  inputs: [{ name: "value", kind: "uint256" }],
  outputs: [],
};

describe("dev state", () => {
  test("opening deploy preview adds a tx.preview feed event", () => {
    const state = devReducer(createInitialDevState(), {
      type: "openDeployPreview",
      event: previewEvent,
    });

    expect(state.modal.type).toBe("txPreview");
    expect(state.feed).toEqual([previewEvent]);
  });

  test("cancel modal closes the current modal", () => {
    const withModal = devReducer(createInitialDevState(), {
      type: "openDeployPreview",
      event: previewEvent,
    });

    const state = devReducer(withModal, { type: "cancelModal" });

    expect(state.modal).toEqual({ type: "none" });
  });

  test("confirming the active transaction preview closes the modal and records it for execution", () => {
    const withModal = devReducer(createInitialDevState(), {
      type: "openDeployPreview",
      event: previewEvent,
    });

    const state = devReducer(withModal, {
      type: "confirmTxPreview",
      previewId: previewEvent.id,
    });

    expect(state.modal).toEqual({ type: "none" });
    expect(state.confirmedTxPreview).toEqual(previewEvent);
  });

  test("stale transaction preview confirmations are ignored", () => {
    const withModal = devReducer(createInitialDevState(), {
      type: "openDeployPreview",
      event: previewEvent,
    });

    const state = devReducer(withModal, {
      type: "confirmTxPreview",
      previewId: "older-preview",
    });

    expect(state.modal).toEqual({
      type: "txPreview",
      event: previewEvent,
      gasLimitMode: "auto",
      gasLimitText: "",
    });
    expect(state.confirmedTxPreview).toBeNull();
  });

  test("modal state is a discriminated union instead of loose booleans", () => {
    const state = createInitialDevState();

    expect(state.modal.type).toBe("none");
    expect("isModalOpen" in state).toBe(false);
    expect("hasPreview" in state).toBe(false);
  });

  test("opens and updates a function input modal from a selected ABI function", () => {
    const withModal = devReducer(createInitialDevState(), {
      type: "openFunctionInput",
      function: writeFunction,
    });

    expect(withModal.modal).toEqual({
      type: "functionInput",
      draft: {
        action: "send",
        function: writeFunction,
        argumentTexts: [""],
        valueText: "",
        gasLimitText: "",
        gasLimitMode: "auto",
        activeField: { kind: "argument", index: 0 },
        history: [],
        historyIndex: null,
      },
    });

    const updated = devReducer(withModal, {
      type: "updateFunctionInputArgument",
      index: 0,
      value: "42",
    });
    const withValue = devReducer(updated, {
      type: "updateFunctionInputValue",
      value: "0.1ether",
    });

    expect(withValue.modal).toEqual({
      type: "functionInput",
      draft: {
        action: "send",
        function: writeFunction,
        argumentTexts: ["42"],
        valueText: "0.1ether",
        gasLimitText: "",
        gasLimitMode: "auto",
        activeField: { kind: "argument", index: 0 },
        history: [],
        historyIndex: null,
      },
    });

    const focused = devReducer(withValue, {
      type: "focusFunctionInputField",
      field: { kind: "value" },
    });

    expect(focused.modal).toEqual({
      type: "functionInput",
      draft: {
        action: "send",
        function: writeFunction,
        argumentTexts: ["42"],
        valueText: "0.1ether",
        gasLimitText: "",
        gasLimitMode: "auto",
        activeField: { kind: "value" },
        history: [],
        historyIndex: null,
      },
    });
  });

  test("opens a constructor input modal as a deploy action", () => {
    const constructorFunction: FunctionItem = {
      name: "constructor",
      signature: "constructor(uint256)",
      state_mutability: "nonpayable",
      kind: "write",
      inputs: [{ name: "initial", kind: "uint256" }],
      outputs: [],
    };

    const state = devReducer(createInitialDevState(), {
      type: "openFunctionInput",
      action: "deploy",
      function: constructorFunction,
    });

    expect(state.modal).toEqual({
      type: "functionInput",
      draft: {
        action: "deploy",
        function: constructorFunction,
        argumentTexts: [""],
        valueText: "",
        gasLimitText: "",
        gasLimitMode: "auto",
        activeField: { kind: "argument", index: 0 },
        history: [],
        historyIndex: null,
      },
    });
  });

  test("Esc from a transaction preview restores the previous function input draft", () => {
    const withInput = devReducer(createInitialDevState(), {
      type: "openFunctionInput",
      function: writeFunction,
    });
    const updated = devReducer(withInput, {
      type: "updateFunctionInputArgument",
      index: 0,
      value: "42",
    });
    const withPreview = devReducer(updated, {
      type: "openDeployPreview",
      event: previewEvent,
    });

    const state = devReducer(withPreview, { type: "cancelModal" });

    expect(state.modal).toEqual({
      type: "functionInput",
      draft: {
        action: "send",
        function: writeFunction,
        argumentTexts: ["42"],
        valueText: "",
        gasLimitText: "",
        gasLimitMode: "auto",
        activeField: { kind: "argument", index: 0 },
        history: [],
        historyIndex: null,
      },
    });
  });

  test("transaction preview gas limit mode is confirmed with the preview event", () => {
    const withPreview = devReducer(createInitialDevState(), {
      type: "openDeployPreview",
      event: previewEvent,
    });
    const custom = devReducer(withPreview, {
      type: "updateTxPreviewGasLimitMode",
      mode: "custom",
    });
    const withLimit = devReducer(custom, {
      type: "updateTxPreviewGasLimit",
      value: "50000",
    });
    const confirmed = devReducer(withLimit, {
      type: "confirmTxPreview",
      previewId: previewEvent.id,
    });

    expect(custom.modal.type === "txPreview" ? custom.modal.gasLimitMode : null).toBe("custom");
    expect(withLimit.modal.type === "txPreview" ? withLimit.modal.gasLimitText : null).toBe("50000");
    expect(confirmed.confirmedTxPreview?.gas.context?.["gasLimit"]).toBe("50000");
  });

  test("records selected source target activation for the dev runtime", () => {
    const state = devReducer(createInitialDevState(), {
      type: "selectSourceTarget",
      sourceFile: "src/Other.sol",
      target: "src/Other.sol:Other",
    });

    expect(state.selectedSourceTarget).toEqual({
      sourceFile: "src/Other.sol",
      target: "src/Other.sol:Other",
    });
  });
});
