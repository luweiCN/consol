/** @jsxImportSource @opentui/solid */
import { For } from "solid-js";
import { terminalCellWidth } from "./terminal-width";
import { theme } from "./theme";

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
                width={terminalCellWidth(tab.label) + 2}
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
