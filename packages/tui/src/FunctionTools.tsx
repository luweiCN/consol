/** @jsxImportSource @opentui/solid */
import {
  functionAbiJson,
  functionHumanReadableAbi,
  functionSelector,
  type FunctionItem,
} from "@consol/core";
import type { MessageKey } from "@consol/i18n";
import { Show, type Accessor } from "solid-js";
import { JsonCodeBlock } from "./JsonCodeBlock";
import type { ModalRect } from "./modal-layout";
import { PickerActionMenu, type PickerActionOption } from "./PickerActionMenu";
import { theme } from "./theme";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export const functionToolActions = [
  "view",
  "copySignature",
  "copySelector",
  "copyAbiJson",
  "copyHumanReadableAbi",
] as const;

export type FunctionToolAction = (typeof functionToolActions)[number];

export function FunctionToolsLayer(props: {
  readonly menuIndex: number | null;
  readonly detailItem: FunctionItem | null;
  readonly translate: Translate;
  readonly rect: ModalRect;
  readonly onToolSelect: (action: FunctionToolAction) => void;
}) {
  return (
    <>
      <Show when={props.menuIndex !== null}>
        <FunctionToolMenu
          selectedIndex={props.menuIndex ?? 0}
          translate={props.translate}
          rect={props.rect}
          onSelect={props.onToolSelect}
        />
      </Show>
      <Show when={props.detailItem}>
        {(functionItem: Accessor<FunctionItem>) => (
          <FunctionDetailModal
            functionItem={functionItem()}
            translate={props.translate}
            rect={props.rect}
          />
        )}
      </Show>
    </>
  );
}

export function FunctionToolMenu(props: {
  readonly selectedIndex: number;
  readonly translate: Translate;
  readonly rect: ModalRect;
  readonly onSelect: (action: FunctionToolAction) => void;
}) {
  const options = () => functionToolOptions(props.translate);
  const width = () => Math.min(42, props.rect.width);
  return (
    <PickerActionMenu
      id="function-tool-menu"
      title={props.translate("tui.function.tools.title")}
      hintKey="tui.function.tools.hint"
      translate={props.translate}
      options={options()}
      selectedIndex={props.selectedIndex}
      top={props.rect.top + Math.max(0, Math.floor((props.rect.height - 9) / 2))}
      left={props.rect.left + Math.max(0, Math.floor((props.rect.width - width()) / 2))}
      width={width()}
      onSelect={(index) => {
        const action = functionToolActions[index];
        if (action !== undefined) {
          props.onSelect(action);
        }
      }}
    />
  );
}

export function FunctionDetailModal(props: {
  readonly functionItem: FunctionItem;
  readonly translate: Translate;
  readonly rect: ModalRect;
}) {
  const abiJson = () => functionAbiJson(props.functionItem);
  return (
    <box
      id="function-detail-modal"
      position="absolute"
      zIndex={35}
      top={props.rect.top}
      left={props.rect.left}
      width={props.rect.width}
      height={props.rect.height}
      border
      borderStyle="rounded"
      borderColor={theme.color.modalBorder}
      backgroundColor={theme.background.overlay}
      title={props.translate("tui.function.detail.title", { name: props.functionItem.name })}
      bottomTitle={props.translate("tui.function.detail.hint")}
      bottomTitleAlignment="right"
      flexDirection="column"
    >
      <scrollbox
        id="function-detail-scrollbox"
        width="100%"
        flexGrow={1}
        scrollY
        scrollX={false}
        verticalScrollbarOptions={theme.scrollbar.vertical}
        contentOptions={{ flexDirection: "column", rowGap: 0 }}
      >
        <FunctionDetailField label={props.translate("tui.function.detail.kind")} value={functionKindLabel(props.functionItem, props.translate)} />
        <FunctionDetailField label={props.translate("tui.function.detail.mutability")} value={props.functionItem.state_mutability} />
        <FunctionDetailField label={props.translate("tui.function.detail.signature")} value={props.functionItem.signature} />
        <FunctionDetailField label={props.translate("tui.function.detail.selector")} value={functionSelector(props.functionItem)} />
        <FunctionDetailField
          label={props.translate("tui.function.args")}
          value={parameterList(props.functionItem.inputs, props.translate("tui.function.noArgs"))}
        />
        <FunctionDetailField
          label={props.translate("tui.function.returns")}
          value={parameterList(props.functionItem.outputs, props.translate("tui.function.noReturns"))}
        />
        {props.functionItem.kind === "payable" ? (
          <FunctionDetailField label={props.translate("tui.function.value")} value={props.translate("tui.function.payableValue")} />
        ) : null}
        <text fg={theme.color.muted} content={`${props.translate("tui.function.detail.humanReadableAbi")}:`} />
        <text selectable fg={theme.color.code} content={functionHumanReadableAbi(props.functionItem)} wrapMode="word" />
        <text fg={theme.color.muted} content={`${props.translate("tui.function.detail.abiJson")}:`} />
        <JsonCodeBlock lines={abiJson().split("\n")} wrapColumn={Math.max(16, props.rect.width - 6)} />
      </scrollbox>
    </box>
  );
}

export function functionToolCopyValue(action: FunctionToolAction, functionItem: FunctionItem): string | null {
  if (action === "copySignature") {
    return functionItem.signature;
  }
  if (action === "copySelector") {
    return functionSelector(functionItem);
  }
  if (action === "copyAbiJson") {
    return functionAbiJson(functionItem);
  }
  if (action === "copyHumanReadableAbi") {
    return functionHumanReadableAbi(functionItem);
  }
  return null;
}

export function functionDetailText(functionItem: FunctionItem, translate: Translate): string {
  const args = parameterDetailLines(functionItem.inputs, translate("tui.function.noArgs"));
  const returns = parameterDetailLines(functionItem.outputs, translate("tui.function.noReturns"));
  return [
    translate("tui.function.detail.title", { name: functionItem.name }),
    "",
    `${translate("tui.function.detail.kind")}: ${functionKindLabel(functionItem, translate)}`,
    `${translate("tui.function.detail.mutability")}: ${functionItem.state_mutability}`,
    `${translate("tui.function.detail.signature")}: ${functionItem.signature}`,
    `${translate("tui.function.detail.selector")}: ${functionSelector(functionItem)}`,
    "",
    `${translate("tui.function.args")}:`,
    ...args,
    `${translate("tui.function.returns")}:`,
    ...returns,
    ...(functionItem.kind === "payable"
      ? ["", `${translate("tui.function.value")}: ${translate("tui.function.payableValue")}`]
      : []),
    "",
    `${translate("tui.function.detail.humanReadableAbi")}:`,
    `  ${functionHumanReadableAbi(functionItem)}`,
    "",
    `${translate("tui.function.detail.abiJson")}:`,
    functionAbiJson(functionItem),
  ].join("\n");
}

function FunctionDetailField(props: { readonly label: string; readonly value: string }) {
  return (
    <box minHeight={1} flexDirection="row">
      <text flexShrink={0} fg={theme.color.muted} content={`${props.label}: `} />
      <text selectable flexGrow={1} flexShrink={1} fg={theme.color.text} content={props.value} wrapMode="word" />
    </box>
  );
}

function functionToolOptions(translate: Translate): readonly PickerActionOption[] {
  return [
    {
      id: "view",
      label: translate("tui.function.tools.viewDetails"),
      group: translate("tui.function.tools.infoGroup"),
    },
    {
      id: "copySignature",
      label: translate("tui.function.tools.copySignature"),
      group: translate("tui.function.tools.copyGroup"),
    },
    { id: "copySelector", label: translate("tui.function.tools.copySelector") },
    { id: "copyAbiJson", label: translate("tui.function.tools.copyAbiJson") },
    { id: "copyHumanReadableAbi", label: translate("tui.function.tools.copyHumanReadableAbi") },
  ];
}

function functionKindLabel(functionItem: FunctionItem, translate: Translate): string {
  return translate(
    functionItem.kind === "read"
      ? "tui.function.group.read"
      : functionItem.kind === "payable"
        ? "tui.function.group.payable"
        : "tui.function.group.write",
  );
}

function parameterList(parameters: FunctionItem["inputs"], empty: string): string {
  return parameters.map((parameter) => `${parameter.name || "_"}:${parameter.kind}`).join(", ") || empty;
}

function parameterDetailLines(parameters: FunctionItem["inputs"], empty: string): readonly string[] {
  return parameters.length === 0
    ? [`  - ${empty}`]
    : parameters.map((parameter) => `  - ${parameter.name || "_"}: ${parameter.kind}`);
}
