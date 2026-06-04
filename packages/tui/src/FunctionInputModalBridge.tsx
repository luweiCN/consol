/** @jsxImportSource @opentui/solid */
import type { DevAction, DevModal } from "@consol/core";
import type { MessageKey } from "@consol/i18n";
import { FunctionInputModalLayer } from "./FunctionInputModal";
import type { ModalRect } from "./modal-layout";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export type FunctionInputModalBridgeProps = {
  readonly modal: DevModal | undefined;
  readonly translate: Translate;
  readonly rect: ModalRect;
  readonly error?: string;
  readonly onDevAction?: (action: DevAction) => void;
};

export function FunctionInputModalBridge(props: FunctionInputModalBridgeProps) {
  return (
    <FunctionInputModalLayer
      modal={props.modal}
      translate={props.translate}
      rect={props.rect}
      {...(props.error === undefined ? {} : { error: props.error })}
      onArgumentChange={(index, value) => {
        if (props.modal?.type === "functionInput" && props.modal.draft.argumentTexts[index] === value) {
          return;
        }

        props.onDevAction?.({ type: "updateFunctionInputArgument", index, value });
      }}
      onValueChange={(valueText) => {
        if (props.modal?.type === "functionInput" && props.modal.draft.valueText === valueText) {
          return;
        }

        props.onDevAction?.({ type: "updateFunctionInputValue", value: valueText });
      }}
      onGasLimitChange={(gasLimitText) => {
        if (props.modal?.type === "functionInput" && props.modal.draft.gasLimitText === gasLimitText) {
          return;
        }
        props.onDevAction?.({ type: "updateFunctionInputGasLimit", value: gasLimitText });
      }}
      onGasLimitModeChange={(mode) => {
        if (props.modal?.type === "functionInput" && props.modal.draft.gasLimitMode === mode) {
          return;
        }
        props.onDevAction?.({ type: "updateFunctionInputGasLimitMode", mode });
      }}
    />
  );
}
