/** @jsxImportSource @opentui/solid */
import { createMemo, For, type JSX } from "solid-js";
import { terminalCellWidth } from "./terminal-width";
import { selectedReadableColor, theme } from "./theme";

export type ResponsivePane<T extends string> = {
  readonly id: T;
  readonly label: string;
};

export type ResponsivePanelGroupProps<T extends string> = {
  readonly panes: readonly ResponsivePane<T>[];
  readonly activePane: T;
  readonly wide: boolean;
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
      <box flexGrow={1} flexDirection="column" rowGap={0}>
        <ResponsivePanelTabs
          panes={props.panes}
          activePane={pane}
          onPaneSelect={props.onPaneSelect}
        />
        {pane === undefined ? null : props.renderPane(pane)}
      </box>
    );
  });

  return <>{content()}</>;
}

function ResponsivePanelTabs<T extends string>(
  props: {
    readonly panes: readonly ResponsivePane<T>[];
    readonly activePane: T | undefined;
    readonly onPaneSelect: (pane: T) => void;
  },
) {
  return (
    <box height={1} width="100%" flexDirection="row">
      <box height={1} flexGrow={1} flexShrink={1} flexDirection="row" columnGap={0} paddingLeft={2}>
        <For each={props.panes}>
          {(pane, index) => {
            const selected = () => pane.id === props.activePane;
            const separator = index() === 0 ? "" : " / ";
            return (
              <box
                height={1}
                width={(separator === "" ? 0 : terminalCellWidth(separator)) + terminalCellWidth(pane.label)}
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
                  width={terminalCellWidth(pane.label)}
                  flexShrink={0}
                  backgroundColor={selected() ? theme.background.selection : "transparent"}
                  onMouseDown={() => {
                    props.onPaneSelect(pane.id);
                  }}
                >
                  <text
                    fg={selectedReadableColor(selected(), theme.color.muted)}
                    content={pane.label}
                    wrapMode="none"
                  />
                </box>
              </box>
            );
          }}
        </For>
      </box>
    </box>
  );
}
