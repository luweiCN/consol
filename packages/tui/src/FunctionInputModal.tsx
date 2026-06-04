/** @jsxImportSource @opentui/solid */
import type { DevFunctionInputDraft, DevFunctionInputField, DevModal } from "@consol/core";
import type { MessageKey } from "@consol/i18n";
import { Show, type Accessor } from "solid-js";
import type { ModalRect } from "./modal-layout";
import { theme } from "./theme";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export type FunctionInputModalProps = {
  readonly draft: DevFunctionInputDraft;
  readonly title: string;
  readonly summaryTitle: string;
  readonly signatureLabel: string;
  readonly argsLabel: string;
  readonly outputsLabel: string;
  readonly actionLabel: string;
  readonly mutabilityLabel: string;
  readonly valueLabel: string;
  readonly gasLimitLabel: string;
  readonly gasLimitAutoLabel: string;
  readonly gasLimitCustomLabel: string;
  readonly hint: string;
  readonly argsPlaceholder: string;
  readonly valuePlaceholder: string;
  readonly gasLimitPlaceholder: string;
  readonly error?: string;
  readonly rect: ModalRect;
  readonly onArgumentChange: (index: number, value: string) => void;
  readonly onValueChange: (valueText: string) => void;
  readonly onGasLimitChange: (gasLimitText: string) => void;
  readonly onGasLimitModeChange: (mode: DevFunctionInputDraft["gasLimitMode"]) => void;
};

export type FunctionInputModalLayerProps = {
  readonly modal: DevModal | undefined;
  readonly translate: Translate;
  readonly rect: ModalRect;
  readonly error?: string;
  readonly onArgumentChange: (index: number, value: string) => void;
  readonly onValueChange: (valueText: string) => void;
  readonly onGasLimitChange: (gasLimitText: string) => void;
  readonly onGasLimitModeChange: (mode: DevFunctionInputDraft["gasLimitMode"]) => void;
};

export function FunctionInputModalLayer(props: FunctionInputModalLayerProps) {
  const draft = () => (props.modal?.type === "functionInput" ? props.modal.draft : undefined);
  return (
    <Show when={draft()}>
      {(inputDraft: Accessor<DevFunctionInputDraft>) => {
        const t = props.translate;
        return (
          <FunctionInputModal
            draft={inputDraft()}
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
            {...(props.error === undefined ? {} : { error: props.error })}
            rect={props.rect}
            onArgumentChange={props.onArgumentChange}
            onValueChange={props.onValueChange}
            onGasLimitChange={props.onGasLimitChange}
            onGasLimitModeChange={props.onGasLimitModeChange}
          />
        );
      }}
    </Show>
  );
}

export function FunctionInputModal(props: FunctionInputModalProps) {
  return (
    <box
      id="modal-function-input"
      position="absolute"
      zIndex={24}
      top={props.rect.top}
      left={props.rect.left}
      width={props.rect.width}
      height={props.rect.height}
      border
      borderStyle="rounded"
      borderColor={theme.color.modalBorder}
      backgroundColor={theme.color.surface}
      title={props.title}
      flexDirection="column"
      paddingX={1}
    >
      <box width="100%" height="100%" flexDirection={props.rect.width >= 70 ? "row" : "column"} columnGap={1} rowGap={0}>
        <box width={props.rect.width >= 70 ? "58%" : "100%"} height="100%" flexDirection="column" rowGap={0}>
          <text fg={theme.color.keyword} content={props.draft.function.signature} />
          <Show when={showArgs(props.draft)}>
            <text fg={theme.color.muted} content={`${props.argsLabel}: ${functionInputs(props.draft)}`} />
            {props.draft.function.inputs.map((input, index) => (
              <box
                border
                borderStyle="rounded"
                borderColor={isActiveArgument(props.draft.activeField, index) ? theme.color.focusedPanelBorder : theme.color.border}
                height={3}
                paddingX={1}
              >
                <input
                  id={`function-arg-input-${index}`}
                  focused={isActiveArgument(props.draft.activeField, index)}
                  value={props.draft.argumentTexts[index] ?? ""}
                  placeholder={argumentPlaceholder(input.name, input.kind, index, props.argsPlaceholder)}
                  backgroundColor={theme.color.surface}
                  textColor={theme.color.text}
                  focusedBackgroundColor={theme.color.surface}
                  focusedTextColor={theme.color.text}
                  placeholderColor={theme.color.muted}
                  onInput={(value) => {
                    props.onArgumentChange(index, value);
                  }}
                />
              </box>
            ))}
          </Show>
          <Show when={showValue(props.draft)}>
            <text fg={theme.color.muted} content={`${props.valueLabel}:`} />
            <box border borderStyle="rounded" borderColor={isActiveValue(props.draft.activeField) ? theme.color.focusedPanelBorder : theme.color.border} height={3} paddingX={1}>
              <input
                id="function-value-input"
                focused={isActiveValue(props.draft.activeField)}
                value={props.draft.valueText}
                placeholder={props.valuePlaceholder}
                backgroundColor={theme.color.surface}
                textColor={theme.color.text}
                focusedBackgroundColor={theme.color.surface}
                focusedTextColor={theme.color.text}
                placeholderColor={theme.color.muted}
                onInput={props.onValueChange}
              />
            </box>
          </Show>
          <text width="100%" fg={theme.color.muted} content={props.hint} wrapMode="char" />
          <Show when={props.error}>
            {(error: Accessor<string>) => <text selectable fg={theme.color.danger} content={error()} wrapMode="char" />}
          </Show>
        </box>
        <box
          width={props.rect.width >= 70 ? "41%" : "100%"}
          height={props.rect.width >= 70 ? "100%" : 6}
          border
          borderStyle="rounded"
          borderColor={theme.color.border}
          backgroundColor={theme.color.surfaceRaised}
          title={props.summaryTitle}
          flexDirection="column"
          paddingX={1}
        >
          <text fg={theme.color.muted} content={`${props.signatureLabel}:`} />
          <text fg={theme.color.text} content={props.draft.function.signature} wrapMode="char" />
          <text fg={theme.color.muted} content={`${props.actionLabel}: ${props.draft.action}`} />
          <text fg={functionKindColor(props.draft.function.kind)} content={`${props.mutabilityLabel}: ${props.draft.function.state_mutability}`} />
          <text fg={theme.color.muted} content={`${props.outputsLabel}: ${functionOutputs(props.draft)}`} wrapMode="char" />
        </box>
      </box>
    </box>
  );
}

function functionInputs(draft: DevFunctionInputDraft): string {
  return draft.function.inputs.map((input) => `${input.name || "_"}:${input.kind}`).join(", ") || "-";
}

function functionOutputs(draft: DevFunctionInputDraft): string {
  return draft.function.outputs.map((output) => output.kind).join(", ") || "-";
}

function showArgs(draft: DevFunctionInputDraft): boolean {
  return draft.function.inputs.length > 0;
}

function showValue(draft: DevFunctionInputDraft): boolean {
  return draft.function.kind === "payable";
}

function isActiveArgument(field: DevFunctionInputField, index: number): boolean {
  return field.kind === "argument" && field.index === index;
}

function isActiveValue(field: DevFunctionInputField): boolean {
  return field.kind === "value";
}

function argumentPlaceholder(name: string, kind: string, index: number, fallback: string): string {
  const label = name.length === 0 ? `_${index + 1}` : name;
  return `${label}:${kind} (${fallback})`;
}

function functionKindColor(kind: DevFunctionInputDraft["function"]["kind"]): string {
  return kind === "read" ? theme.color.read : kind === "payable" ? theme.color.payable : theme.color.write;
}
