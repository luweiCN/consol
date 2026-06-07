/** @jsxImportSource @opentui/solid */
import { For } from "solid-js";
import { theme } from "./theme";

const wideTerminalCodePointRanges = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0x303e],
  [0x3040, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
] as const;

export type WorkspaceTab<T extends string> = {
  readonly id: T;
  readonly label: string;
};

export function WorkspaceBar<T extends string>(props: {
  readonly tabs: readonly WorkspaceTab<T>[];
  readonly activeTab: T;
  readonly title: string;
  readonly switchHint: string;
  readonly onChange: (tab: T) => void;
}) {
  return (
    <box
      id="workspace-tabs"
      height={3}
      border
      borderStyle="rounded"
      borderColor={theme.color.workspaceBorder}
      title={props.title}
      bottomTitle={props.switchHint}
      bottomTitleAlignment="right"
      paddingX={1}
      flexDirection="row"
    >
      <box height={1} flexDirection="row" columnGap={1}>
        <For each={props.tabs}>
          {(tab) => {
            const selected = () => tab.id === props.activeTab;
            return (
              <box
                height={1}
                width={terminalColumnWidth(tab.label) + 2}
                flexShrink={0}
                backgroundColor={selected() ? theme.background.selection : "transparent"}
                onMouseDown={() => {
                  props.onChange(tab.id);
                }}
              >
                <text
                  fg={selected() ? theme.color.selected : theme.color.muted}
                  content={` ${tab.label} `}
                  wrapMode="none"
                />
              </box>
            );
          }}
        </For>
      </box>
    </box>
  );
}

function terminalColumnWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    width += isWideTerminalCodePoint(codePoint) ? 2 : 1;
  }
  return Math.max(1, width);
}

function isWideTerminalCodePoint(codePoint: number): boolean {
  return wideTerminalCodePointRanges.some((range) => isCodePointInRange(codePoint, range));
}

function isCodePointInRange(codePoint: number, range: readonly [number, number]): boolean {
  return range[0] <= codePoint && codePoint <= range[1];
}
