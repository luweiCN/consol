/** @jsxImportSource @opentui/solid */
import type { MessageKey } from "@consol/i18n";
import { selectedBoxBackground, theme } from "./theme";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export type PickerActionOption = {
  readonly id: string;
  readonly label: string;
  readonly group?: string;
  readonly danger?: boolean;
};

export function PickerActionMenu(props: {
  readonly id: string;
  readonly title: string;
  readonly hintKey: MessageKey;
  readonly translate: Translate;
  readonly options: readonly PickerActionOption[];
  readonly selectedIndex: number;
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly zIndex?: number;
}) {
  const t = props.translate;
  return (
    <box
      id={props.id}
      position="absolute"
      zIndex={props.zIndex ?? 41}
      top={props.top}
      left={props.left}
      width={props.width}
      border
      borderStyle="rounded"
      borderColor={theme.color.modalBorder}
      backgroundColor={theme.background.overlay}
      title={props.title}
      flexDirection="column"
      height={menuHeight(props.options)}
      paddingX={1}
      bottomTitle={t(props.hintKey)}
      bottomTitleAlignment="right"
    >
      {groupedOptions(props.options).map((item) =>
        item.kind === "group"
          ? <text fg={theme.color.muted} content={item.label} />
          : (
            <box height={1} {...selectedBoxBackground(item.index === props.selectedIndex)}>
              <text
                fg={item.index === props.selectedIndex ? theme.color.selected : item.option.danger === true ? theme.color.danger : theme.color.text}
                content={`${item.index === props.selectedIndex ? "> " : "  "}${item.option.label}`}
              />
            </box>
          )
      )}
    </box>
  );
}

function menuHeight(options: readonly PickerActionOption[]): number {
  const groups = new Set(options.map((option) => option.group).filter((group) => group !== undefined));
  return Math.max(4, 2 + groups.size + options.length);
}

function groupedOptions(options: readonly PickerActionOption[]): readonly (
  | { readonly kind: "group"; readonly label: string }
  | { readonly kind: "option"; readonly index: number; readonly option: PickerActionOption }
)[] {
  const rows: (
    | { readonly kind: "group"; readonly label: string }
    | { readonly kind: "option"; readonly index: number; readonly option: PickerActionOption }
  )[] = [];
  let previousGroup: string | undefined;
  options.forEach((option, index) => {
    if (option.group !== undefined && option.group !== previousGroup) {
      rows.push({ kind: "group", label: option.group });
      previousGroup = option.group;
    }
    rows.push({ kind: "option", index, option });
  });
  return rows;
}
