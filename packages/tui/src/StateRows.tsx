/** @jsxImportSource @opentui/solid */
import type { MessageKey } from "@consol/i18n";
import type { DevStateValueSnapshot, DevStorageStateRowSnapshot } from "./runtime-types";
import { theme } from "./theme";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export type StateDetailLine = {
  readonly fg: string;
  readonly content: string;
};

export function StateStorageRowLine(props: {
  readonly row: DevStorageStateRowSnapshot;
  readonly selected: boolean;
  readonly id?: string;
  readonly index?: number;
  readonly onSelect?: (index: number) => void;
}) {
  const marker = () => props.selected ? "> " : "  ";
  const color = () => {
    if (props.row.kind === "error") {
      return theme.color.danger;
    }
    return props.selected ? theme.color.accent : theme.color.text;
  };

  return (
    <box
      {...(props.id === undefined ? {} : { id: props.id })}
      minHeight={1}
      paddingX={1}
      flexDirection="column"
      backgroundColor={props.selected ? theme.color.selectionBg : theme.color.buttonBg}
      onMouseDown={() => {
        if (props.index !== undefined) {
          props.onSelect?.(props.index);
        }
      }}
    >
      <text
        selectable
        fg={color()}
        content={`${marker()}${props.row.name}  ${props.row.typeLabel}  ${props.row.summary}`}
        wrapMode="word"
      />
    </box>
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
      backgroundColor={theme.color.surface}
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
