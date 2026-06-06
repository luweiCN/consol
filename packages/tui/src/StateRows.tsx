/** @jsxImportSource @opentui/solid */
import type { MessageKey } from "@consol/i18n";
import type { ColorInput } from "@opentui/core";
import type { DevStateValueSnapshot, DevStorageStateRowSnapshot } from "./runtime-types";
import { selectedBoxBackground, selectedReadableColor, theme } from "./theme";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export type StateDetailLine = {
  readonly fg: ColorInput;
  readonly content: string;
};

export type StateItemField = {
  readonly label: string;
  readonly value: string;
};

export function StateItemRow(props: {
  readonly title: string;
  readonly titleMeta?: string;
  readonly titleColor: ColorInput;
  readonly selected: boolean;
  readonly fields: readonly StateItemField[];
  readonly detailFields?: readonly StateItemField[];
  readonly id?: string;
  readonly minHeight?: number;
  readonly index?: number;
  readonly onSelect?: (index: number) => void;
}) {
  return (
    <box
      {...(props.id === undefined ? {} : { id: props.id })}
      minHeight={props.minHeight ?? 2}
      paddingX={1}
      flexDirection="column"
      {...selectedBoxBackground(props.selected)}
      onMouseDown={() => {
        if (props.index !== undefined) {
          props.onSelect?.(props.index);
        }
      }}
    >
      <StateItemTitle
        title={props.title}
        titleColor={props.selected ? theme.color.selected : props.titleColor}
        selected={props.selected}
        {...(props.titleMeta === undefined ? {} : { titleMeta: props.titleMeta })}
      />
      {props.fields.map((field) => (
        <StateFieldRow
          field={field}
          fg={props.selected ? theme.color.text : theme.color.muted}
        />
      ))}
      {(props.detailFields ?? []).map((field) => (
        <StateFieldRow
          field={field}
          fg={selectedReadableColor(props.selected, theme.color.muted)}
        />
      ))}
    </box>
  );
}

function StateItemTitle(props: {
  readonly title: string;
  readonly titleMeta?: string;
  readonly titleColor: ColorInput;
  readonly selected: boolean;
}) {
  return (
    <box height="auto" flexDirection="row">
      <text
        selectable
        flexShrink={0}
        fg={props.titleColor}
        content={`${props.selected ? "> " : "  "}${compactStateText(props.title)}${props.titleMeta === undefined ? "" : " "}`}
        wrapMode="none"
      />
      {props.titleMeta === undefined ? null : (
        <text
          selectable
          flexGrow={1}
          flexShrink={1}
          fg={theme.color.type}
          content={`(${props.titleMeta.trim()})`}
          wrapMode="word"
        />
      )}
    </box>
  );
}

function StateFieldRow(props: {
  readonly field: StateItemField;
  readonly fg: ColorInput;
}) {
  return (
    <box height="auto" flexDirection="row">
      <text
        selectable
        flexShrink={0}
        fg={props.fg}
        content={`  ${props.field.label}: `}
        wrapMode="none"
      />
      <text
        selectable
        flexGrow={1}
        flexShrink={1}
        fg={props.fg}
        content={stateFieldText(props.field.value)}
        wrapMode="word"
      />
    </box>
  );
}

export function StateStorageRowLine(props: {
  readonly row: DevStorageStateRowSnapshot;
  readonly selected: boolean;
  readonly translate: Translate;
  readonly id?: string;
  readonly index?: number;
  readonly onSelect?: (index: number) => void;
}) {
  const color = () => {
    if (props.row.kind === "error") {
      return theme.color.danger;
    }
    return props.selected ? theme.color.accent : theme.color.text;
  };

  return (
    <StateItemRow
      {...(props.id === undefined ? {} : { id: props.id })}
      title={props.row.name}
      titleMeta={props.row.typeLabel}
      titleColor={color()}
      selected={props.selected}
      fields={[
        { label: props.translate("tui.state.detail.summary"), value: props.row.summary },
      ]}
      {...(props.index === undefined ? {} : { index: props.index })}
      {...(props.onSelect === undefined ? {} : { onSelect: props.onSelect })}
    />
  );
}

export function StateDetailModal(props: {
  readonly title: string;
  readonly lines: readonly StateDetailLine[];
  readonly hint: string;
  readonly rect: { readonly top: number; readonly left: number; readonly width: number; readonly height: number };
}) {
  return (
    <box
      id="state-detail-modal"
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
      title={props.title}
      bottomTitle={props.hint}
      bottomTitleAlignment="right"
      flexDirection="column"
    >
      <scrollbox
        id="state-detail-scrollbox"
        width="100%"
        height="100%"
        scrollY
        scrollX={false}
        verticalScrollbarOptions={theme.scrollbar.vertical}
        contentOptions={{ flexDirection: "column", rowGap: 0 }}
      >
        {props.lines.map((line) => (
          <text selectable fg={line.fg} content={line.content} wrapMode="word" />
        ))}
      </scrollbox>
    </box>
  );
}

export function stateValueDetailLines(value: DevStateValueSnapshot, translate: Translate): readonly StateDetailLine[] {
  const error = value.error?.trim();
  return [
    { fg: error === undefined || error.length === 0 ? theme.color.read : theme.color.danger, content: value.name },
    { fg: theme.color.muted, content: `${translate("tui.state.signature")}: ${value.signature}` },
    { fg: theme.color.text, content: `${translate("tui.state.detail.type")}: ${value.output_types.join(",") || translate("tui.state.raw")}` },
    ...(error === undefined || error.length === 0
      ? [
        { fg: theme.color.text, content: `${translate("tui.state.decoded")}: ${value.readable ?? "-"}` },
        { fg: theme.color.code, content: `${translate("tui.state.raw")}: ${value.raw}` },
      ]
      : [{ fg: theme.color.danger, content: `${translate("tui.state.error")}: ${error}` }]),
  ];
}

export function stateStorageRowDetailLines(row: DevStorageStateRowSnapshot, translate: Translate): readonly StateDetailLine[] {
  const lines: StateDetailLine[] = [
    { fg: row.kind === "error" ? theme.color.danger : theme.color.read, content: row.name },
    { fg: theme.color.text, content: `${translate("tui.state.detail.type")}: ${row.typeLabel}` },
    { fg: theme.color.text, content: `${translate("tui.state.detail.kind")}: ${row.kind}` },
    { fg: theme.color.text, content: `${translate("tui.state.detail.summary")}: ${row.summary}` },
  ];

  if (row.checked !== undefined) {
    lines.push({ fg: theme.color.text, content: `${translate("tui.state.detail.checked")}: ${row.checked}` });
  }
  if (row.nonDefault !== undefined) {
    lines.push({ fg: theme.color.text, content: `${translate("tui.state.detail.nonDefault")}: ${row.nonDefault}` });
  }
  if (row.defaultValuesHidden === true) {
    lines.push({ fg: theme.color.muted, content: translate("tui.state.detail.defaultValuesHidden") });
  }
  if (row.error !== undefined && row.error !== null && row.error.length > 0) {
    lines.push({ fg: theme.color.danger, content: `${translate("tui.state.error")}: ${row.error}` });
  }

  lines.push({ fg: theme.color.muted, content: `${translate("tui.state.detail.rowId")}: ${row.id}` });
  return lines;
}

export function stateDetailText(lines: readonly StateDetailLine[]): string {
  return lines.map((line) => line.content).join("\n").trim();
}

export function compactStateText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 80) {
    return trimmed;
  }
  if (trimmed.startsWith("0x") && trimmed.length > 26) {
    return `${trimmed.slice(0, 12)}...${trimmed.slice(-8)}`;
  }
  return `${trimmed.slice(0, 60)}...${trimmed.slice(-14)}`;
}

function stateFieldText(value: string): string {
  return value.trim();
}
