/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { DevFunctionInputDraft } from "@consol/core";
import { createTranslator } from "@consol/i18n";
import { FunctionInputModal } from "./FunctionInputModal";

const baseDraft = {
  action: "send",
  function: {
    name: "setNumber",
    signature: "setNumber(uint256)",
    state_mutability: "nonpayable",
    kind: "write",
    inputs: [{ name: "value", kind: "uint256" }],
    outputs: [],
  },
  argumentTexts: [""],
  valueText: "",
  gasLimitText: "",
  gasLimitMode: "auto",
  activeField: { kind: "argument", index: 0 },
  history: [],
  historyIndex: null,
} as const satisfies DevFunctionInputDraft;

describe("FunctionInputModal", () => {
  test("uint arguments and payable value placeholders mention unit examples", async () => {
    const t = createTranslator("en-US");
    const payableDraft: DevFunctionInputDraft = {
      ...baseDraft,
      function: {
        ...baseDraft.function,
        name: "deposit",
        signature: "deposit(uint256)",
        state_mutability: "payable",
        kind: "payable",
      },
      activeField: { kind: "value" },
    };
    const setup = await testRender(
      () => (
        <FunctionInputModal
          draft={payableDraft}
          title={t("tui.modal.function.title")}
          summaryTitle={t("tui.modal.function.summary")}
          signatureLabel={t("tui.modal.function.signature")}
          argsLabel={t("tui.modal.function.args")}
          outputsLabel={t("tui.modal.function.outputs")}
          actionLabel={t("tx.preview.action")}
          mutabilityLabel={t("tui.modal.function.mutability")}
          valueLabel={t("tui.modal.function.value")}
          gasLimitLabel={t("tui.modal.function.gasLimit")}
          gasLimitAutoLabel={t("tui.modal.function.gasLimit.auto")}
          gasLimitCustomLabel={t("tui.modal.function.gasLimit.custom")}
          hint={t("tui.modal.function.hint")}
          argsPlaceholder={t("tui.modal.function.argsPlaceholder")}
          valuePlaceholder={t("tui.modal.function.valuePlaceholder")}
          gasLimitPlaceholder={t("tui.modal.function.gasLimitPlaceholder")}
          rect={{ top: 0, left: 0, width: 120, height: 20 }}
          onArgumentChange={() => {}}
          onValueChange={() => {}}
          onGasLimitChange={() => {}}
          onGasLimitModeChange={() => {}}
        />
      ),
      { width: 122, height: 22 },
    );
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("1, 1ether, 0.5ether, 100gwei");
  });
});
