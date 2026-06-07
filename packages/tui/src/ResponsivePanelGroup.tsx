/** @jsxImportSource @opentui/solid */
import { createMemo, For, type JSX } from "solid-js";
import { selectedBoxBackground, selectedReadableColor, theme } from "./theme";

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

export type ResponsivePane<T extends string> = {
  readonly id: T;
  readonly label: string;
};

export type ResponsivePanelGroupProps<T extends string> = {
  readonly panes: readonly ResponsivePane<T>[];
  readonly activePane: T;
  readonly wide: boolean;
  readonly hint?: string | undefined;
  readonly onPaneSelect: (pane: T) => void;
  readonly renderWide: () => JSX.Element;
  readonly renderPane: (pane: T) => JSX.Element;
};

export function ResponsivePanelGroup<T extends string>(
  props: ResponsivePanelGroupProps<T>,
) {
  const activePane = createMemo(() =>
    props.panes.some((pane) => pane.id === props.activePane)
      ? props.activePane
      : props.panes[0]?.id,
  );
  const content = createMemo(() => {
    if (props.wide) {
      return props.renderWide();
    }

    const pane = activePane();
    return (
      <box flexGrow={1} flexDirection="column" rowGap={0} position="relative">
        {pane === undefined ? null : props.renderPane(pane)}
        <ResponsivePanelTabs
          panes={props.panes}
          activePane={pane}
          hint={props.hint}
          onPaneSelect={props.onPaneSelect}
        />
      </box>
    );
  });

  return <>{content()}</>;
}

function ResponsivePanelTabs<T extends string>(
  props: {
    readonly panes: readonly ResponsivePane<T>[];
    readonly activePane: T | undefined;
    readonly hint: string | undefined;
    readonly onPaneSelect: (pane: T) => void;
  },
) {
  return (
    <>
      <box height={1} position="absolute" top={0} left={2} zIndex={1} flexDirection="row" columnGap={0}>
        <For each={props.panes}>
          {(pane, index) => {
            const selected = pane.id === props.activePane;
            const separator = index() === 0 ? "" : " / ";
            return (
              <box
                height={1}
                width={(separator === "" ? 0 : terminalColumnWidth(separator)) + terminalColumnWidth(pane.label)}
                flexShrink={0}
                flexDirection="row"
              >
                {separator === "" ? null : (
                  <text
                    fg={theme.color.border}
                    bg={theme.background.overlay}
                    content={separator}
                    wrapMode="none"
                  />
                )}
                <box
                  height={1}
                  width={terminalColumnWidth(pane.label)}
                  flexShrink={0}
                  {...selectedBoxBackground(selected)}
                  onMouseDown={() => {
                    props.onPaneSelect(pane.id);
                  }}
                >
                  <text
                    fg={selectedReadableColor(selected, theme.color.muted)}
                    content={pane.label}
                    wrapMode="none"
                  />
                </box>
              </box>
            );
          }}
        </For>
      </box>
      {props.hint === undefined ? null : (
        <box height={1} position="absolute" top={0} right={2} zIndex={2}>
          <text fg={theme.color.muted} bg={theme.background.overlay} content={props.hint} wrapMode="none" />
        </box>
      )}
    </>
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
