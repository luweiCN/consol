/** @jsxImportSource @opentui/solid */
import type { DevGasLimitMode, DevModal } from "@consol/core";
import type { MessageKey } from "@consol/i18n";
import type { ColorInput } from "@opentui/core";
import { Show, type Accessor } from "solid-js";
import type { ModalRect } from "./modal-layout";
import { theme } from "./theme";

type TxPreviewEvent = Extract<DevModal, { readonly type: "txPreview" }>["event"];
type TxPreviewModalState = Extract<DevModal, { readonly type: "txPreview" }>;
type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;
type PreviewLine = { readonly text: string; readonly color: ColorInput };

export type TxPreviewModalLabels = {
  readonly action: string;
  readonly network: string;
  readonly account: string;
  readonly signer: string;
  readonly target: string;
  readonly gas: string;
  readonly gasLimit: string;
  readonly gasLimitAuto: string;
  readonly gasLimitCustom: string;
  readonly gasLimitEditable: string;
  readonly gasLimitMode: string;
  readonly gasLimitUnit: string;
  readonly gasModeHint: string;
  readonly gasLimitPlaceholder: string;
  readonly gasSource: string;
  readonly gasConfidence: string;
  readonly gasUnavailable: string;
  readonly gasError: string;
  readonly calldata: string;
  readonly executionSettings: string;
  readonly deployRequired: string;
  readonly function: string;
  readonly arguments: string;
  readonly argument: (index: number) => string;
  readonly value: string;
  readonly hex: string;
  readonly followup: string;
  readonly hint: string;
};

export type TxPreviewModalProps = {
  readonly event: TxPreviewEvent;
  readonly gasLimitMode: () => DevGasLimitMode;
  readonly gasLimitText: () => string;
  readonly title: string;
  readonly labels: TxPreviewModalLabels;
  readonly rect: ModalRect;
  readonly onGasLimitModeChange: (mode: DevGasLimitMode) => void;
  readonly onGasLimitChange: (value: string) => void;
};

export type TxPreviewModalLayerProps = {
  readonly modal: DevModal | undefined;
  readonly translate: Translate;
  readonly rect: ModalRect;
  readonly onGasLimitModeChange?: (mode: DevGasLimitMode) => void;
  readonly onGasLimitChange?: (value: string) => void;
};

export function TxPreviewModalLayer(props: TxPreviewModalLayerProps) {
  const txPreviewModal = () => (props.modal?.type === "txPreview" ? props.modal : undefined);
  return (
    <Show when={txPreviewModal()}>
      {(modal: Accessor<TxPreviewModalState>) => {
        const t = props.translate;
        return (
          <TxPreviewModal
            event={modal().event}
            gasLimitMode={() => txPreviewModal()?.gasLimitMode ?? "auto"}
            gasLimitText={() => txPreviewModal()?.gasLimitText ?? ""}
            title={t("tx.preview.title")}
            labels={{
              action: t("tx.preview.action"),
              network: t("tx.preview.network"),
              account: t("tx.preview.account"),
              signer: t("tx.preview.signer"),
              target: t("tx.preview.target"),
              gas: t("tx.preview.gas"),
              gasLimit: t("tx.preview.gasLimit"),
              gasLimitAuto: t("tui.modal.function.gasLimit.auto"),
              gasLimitCustom: t("tui.modal.function.gasLimit.custom"),
              gasLimitEditable: t("tx.preview.gasLimitEditable"),
              gasLimitMode: t("tx.preview.gasLimitMode"),
              gasLimitUnit: t("tx.preview.gasLimitUnit"),
              gasModeHint: t("tx.preview.gasModeHint"),
              gasLimitPlaceholder: t("tui.modal.function.gasLimitPlaceholder"),
              gasSource: t("tx.preview.gasSource"),
              gasConfidence: t("tx.preview.gasConfidence"),
              gasUnavailable: t("tx.preview.gasUnavailable"),
              gasError: t("tx.preview.gasError"),
              calldata: t("tx.preview.calldata"),
              executionSettings: t("tx.preview.executionSettings"),
              deployRequired: t("tx.preview.deployRequired"),
              function: t("tx.preview.function"),
              arguments: t("tx.preview.arguments"),
              argument: (index) => t("tx.preview.argument", { index }),
              value: t("tx.preview.value"),
              hex: t("tx.preview.hex"),
              followup: t("tx.preview.followup"),
              hint: t("tx.preview.confirmHint"),
            }}
            rect={props.rect}
            onGasLimitModeChange={(mode) => props.onGasLimitModeChange?.(mode)}
            onGasLimitChange={(value) => props.onGasLimitChange?.(value)}
          />
        );
      }}
    </Show>
  );
}

export function TxPreviewModal(props: TxPreviewModalProps) {
  const horizontal = () => props.rect.width >= 64;
  const bodyHeight = () => Math.max(8, props.rect.height - 4);
  const compactDetailsHeight = () => Math.max(6, Math.floor(bodyHeight() / 2));
  const gasSettingLines = () => gasLines(props.labels, props.event.gas, props.gasLimitMode(), props.gasLimitText());

  return (
    <box
      id="modal-tx-preview"
      position="absolute"
      zIndex={25}
      top={props.rect.top}
      left={props.rect.left}
      width={props.rect.width}
      height={props.rect.height}
      border
      borderStyle="rounded"
      borderColor={theme.color.modalBorder}
      backgroundColor={theme.background.overlay}
      title={props.title}
      bottomTitle={props.labels.hint}
      bottomTitleAlignment="right"
      focused
      focusable
      flexDirection="column"
      paddingX={1}
    >
      <box width="100%" height={bodyHeight()} flexDirection={horizontal() ? "row" : "column"} columnGap={1} rowGap={1}>
        <box width={horizontal() ? "39%" : "100%"} height={horizontal() ? bodyHeight() : compactDetailsHeight()} flexDirection="column">
          {previewContextLines(props.event, props.labels).map((line) => (
            <text selectable height={1} fg={line.color} content={line.text} wrapMode="char" />
          ))}
          <text selectable height={1} fg={theme.color.keyword} content={props.labels.executionSettings} wrapMode="char" />
          <text selectable height={1} fg={theme.color.selected} content={props.labels.gasLimitEditable} wrapMode="char" />
          <text selectable height={1} fg={theme.color.muted} content={`${props.labels.gasLimitMode}: ${props.labels.gasModeHint}`} wrapMode="char" />
          <GasLimitModeTabs labels={props.labels} mode={props.gasLimitMode} />
          {gasSettingLines().map((line) => (
            <text selectable height={1} fg={line.color} content={line.text} wrapMode="char" />
          ))}
          <GasLimitCustomInput
            active={() => props.gasLimitMode() === "custom"}
            value={props.gasLimitText}
            placeholder={props.labels.gasLimitPlaceholder}
            unitLabel={props.labels.gasLimitUnit}
            onInput={props.onGasLimitChange}
          />
        </box>
        <box
          width={horizontal() ? "60%" : "100%"}
          height={horizontal() ? bodyHeight() : compactDetailsHeight()}
          border
          borderStyle="rounded"
          borderColor={theme.color.border}
          title={props.labels.calldata}
          flexDirection="column"
          paddingX={1}
        >
          <scrollbox
            id="modal-tx-preview-details-scrollbox"
            width="100%"
            height="100%"
            scrollY
            scrollX={false}
            verticalScrollbarOptions={theme.scrollbar.vertical}
            contentOptions={{ flexDirection: "column" }}
          >
            {previewDataLines(props.event, props.labels).map((line) => (
              <text selectable height={1} fg={line.color} content={line.text} wrapMode="char" />
            ))}
          </scrollbox>
        </box>
      </box>
    </box>
  );
}

function GasLimitCustomInput(props: {
  readonly active: () => boolean;
  readonly value: () => string;
  readonly placeholder: string;
  readonly unitLabel: string;
  readonly onInput: (value: string) => void;
}) {
  return (
    <Show when={props.active()}>
      <box
        border
        borderStyle="rounded"
        borderColor={theme.color.borderFocus}
        height={3}
        paddingX={1}
        bottomTitle={props.unitLabel}
        bottomTitleAlignment="right"
      >
        <input
          id="tx-preview-gas-limit-input"
          focused
          value={props.value()}
          placeholder={props.placeholder}
          textColor={theme.color.text}
          focusedTextColor={theme.color.text}
          placeholderColor={theme.color.muted}
          onInput={props.onInput}
        />
      </box>
    </Show>
  );
}

function GasLimitModeTabs(props: {
  readonly labels: TxPreviewModalLabels;
  readonly mode: () => DevGasLimitMode;
}) {
  return (
    <box height={1} flexDirection="row" columnGap={2}>
      <GasLimitModeTab label={props.labels.gasLimitAuto} active={() => props.mode() === "auto"} />
      <GasLimitModeTab label={props.labels.gasLimitCustom} active={() => props.mode() === "custom"} />
    </box>
  );
}

function GasLimitModeTab(props: {
  readonly label: string;
  readonly active: () => boolean;
}) {
  const content = () => props.active() ? `[ ${props.label} ]` : `  ${props.label}  `;
  return (
    <box height={1} width={terminalCellWidth(content())}>
      <text
        height={1}
        fg={props.active() ? theme.color.selected : theme.color.muted}
        content={content()}
        wrapMode="none"
      />
    </box>
  );
}

function terminalCellWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    width += isWideTerminalCodePoint(char.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

function isWideTerminalCodePoint(codePoint: number): boolean {
  return WIDE_TERMINAL_CODE_POINT_RANGES.some(function isInRange(range) {
    return Math.max(range[0] - codePoint, codePoint - range[1]) <= 0;
  });
}

const WIDE_TERMINAL_CODE_POINT_RANGES: readonly (readonly [number, number])[] = [
  [0x2E80, 0xA4CF],
  [0xAC00, 0xD7A3],
  [0xF900, 0xFAFF],
  [0xFE10, 0xFE6F],
  [0xFF00, 0xFF60],
  [0xFFE0, 0xFFE6],
];

function previewContextLines(event: TxPreviewEvent, labels: TxPreviewModalLabels): readonly PreviewLine[] {
  const action = event.gas.context?.["fresh"] === true ? "redeploy" : event.action;
  return [
    { text: `${labels.action}: ${action} ${event.target.contract}`, color: previewActionColor(event.action) },
    ...(event.action === "deploy" && event.followup !== undefined
      ? [{ text: labels.deployRequired, color: theme.color.write }]
      : []),
    ...(event.followup === undefined
      ? []
      : [{ text: `${labels.followup}: ${event.followup.action} ${event.followup.calldata.signature ?? event.followup.calldata.function}`, color: theme.color.write }]),
    { text: `${labels.network}: ${event.network.name} #${event.network.chainId}`, color: theme.color.text },
    { text: `${labels.account}: ${event.account.name ?? event.account.address} / ${event.signer.source}`, color: theme.color.text },
    { text: `${labels.signer}: ${event.signer.name}`, color: theme.color.text },
    { text: `${labels.target}: ${event.target.display}`, color: theme.color.muted },
  ];
}

function previewActionColor(action: TxPreviewEvent["action"]): ColorInput {
  return action === "deploy" ? theme.color.write : action === "read" ? theme.color.read : theme.color.payable;
}

function previewDataLines(event: TxPreviewEvent, labels: TxPreviewModalLabels): readonly PreviewLine[] {
  if (event.followup !== undefined) {
    return [
      { text: `${labels.followup}: ${event.followup.action} ${event.followup.calldata.signature ?? event.followup.calldata.function}`, color: theme.color.write },
      ...argumentLines(labels, event.followup.calldata.args),
      ...(event.followup.value === undefined || event.followup.value === null
        ? []
        : [{ text: `${labels.value}: ${event.followup.value}`, color: theme.color.payable }]),
      { text: `${labels.hex}: ${event.followup.calldata.hex}`, color: theme.color.code },
      { text: "", color: theme.color.muted },
      ...calldataLines(labels, event.calldata, event.value),
    ];
  }

  return [
    ...calldataLines(labels, event.calldata, event.value),
  ];
}

function calldataLines(
  labels: TxPreviewModalLabels,
  calldata: TxPreviewEvent["calldata"],
  value?: string | null,
): readonly PreviewLine[] {
  return [
    { text: `${labels.function}: ${calldata.signature ?? calldata.function}`, color: theme.color.keyword },
    ...argumentLines(labels, calldata.args),
    ...(value === undefined || value === null ? [] : [{ text: `${labels.value}: ${value}`, color: theme.color.payable }]),
    { text: `${labels.hex}: ${calldata.hex}`, color: theme.color.code },
  ];
}

function argumentLines(
  labels: TxPreviewModalLabels,
  args: readonly string[],
): readonly PreviewLine[] {
  if (args.length === 0) {
    return [{ text: `${labels.arguments}: -`, color: theme.color.muted }];
  }

  return args.map((arg, index) => ({ text: `${labels.argument(index + 1)}: ${arg}`, color: theme.color.text }));
}

function gasLines(
  labels: TxPreviewModalLabels,
  gas: TxPreviewEvent["gas"],
  mode: DevGasLimitMode,
  gasLimitValue: string,
): readonly PreviewLine[] {
  const estimate = gas.estimate === undefined ? labels.gasUnavailable : String(gas.estimate);
  const error = typeof gas.context?.["error"] === "string" ? gas.context["error"] : undefined;
  const customLimit = mode === "custom" && gasLimitValue.trim().length > 0
    ? [{ text: `${labels.gasLimit}: ${gasLimitValue.trim()}`, color: theme.color.selected }]
    : [];
  return [
    ...customLimit,
    { text: `${labels.gas}: ${estimate}`, color: gas.estimate === undefined ? theme.color.muted : theme.color.read },
    { text: `${labels.gasSource}: ${gas.source}`, color: theme.color.muted },
    { text: `${labels.gasConfidence}: ${gas.confidence ?? "-"}`, color: theme.color.muted },
    ...(error === undefined ? [] : [{ text: `${labels.gasError}: ${error}`, color: theme.color.danger }]),
  ];
}
