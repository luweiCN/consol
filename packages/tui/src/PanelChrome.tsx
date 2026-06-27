/** @jsxImportSource @opentui/solid */
import type { DevPanel } from "@consol/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createEffect, Show, type Accessor, type JSX } from "solid-js";
import type { DevBuildDiagnosticsSnapshot } from "./runtime-types";
import { theme } from "./theme";
import { feedEntryColor, type Translate } from "./panel-format";

export type DiagnosticsDetailsProps = {
  readonly snapshot: DevBuildDiagnosticsSnapshot | undefined;
  readonly fallback: string;
  readonly translate: Translate;
};

export function DiagnosticsDetails(props: DiagnosticsDetailsProps) {
  return (
    <Show when={props.snapshot} fallback={<text fg={theme.color.muted} content={props.fallback} />}>
      {(snapshot: Accessor<DevBuildDiagnosticsSnapshot>) => (
        <scrollbox
          id="diagnostics-scrollbox"
          width="100%"
          height="100%"
          scrollY
          scrollX={false}
          verticalScrollbarOptions={theme.scrollbar.vertical}
          contentOptions={{ flexDirection: "column" }}
        >
          <text selectable fg={snapshot().status === "success" ? theme.color.read : theme.color.danger} content={snapshot().message} wrapMode="word" />
          {snapshot().diagnostics.length === 0 ? (
            <text fg={theme.color.muted} content={props.translate("tui.diagnostics.empty")} />
          ) : (
            snapshot().diagnostics.map((diagnostic: DevBuildDiagnosticsSnapshot["diagnostics"][number]) => (
              <box minHeight={3} paddingX={1} flexDirection="column">
                <text
                  selectable
                  fg={diagnostic.severity === "error" ? theme.color.danger : theme.color.write}
                  content={`${diagnostic.severity}${diagnostic.code === null ? "" : ` ${diagnostic.code}`}`}
                  wrapMode="none"
                />
                <text selectable fg={theme.color.muted} content={diagnosticLocation(diagnostic)} wrapMode="word" />
                <text selectable fg={theme.color.text} content={diagnostic.message} wrapMode="word" />
              </box>
            ))
          )}
        </scrollbox>
      )}
    </Show>
  );
}

function diagnosticLocation(diagnostic: DevBuildDiagnosticsSnapshot["diagnostics"][number]): string {
  if (diagnostic.file === null) {
    return diagnostic.source;
  }

  const line = diagnostic.line === null ? "" : `:${diagnostic.line}`;
  const column = diagnostic.column === null ? "" : `:${diagnostic.column}`;
  return `${diagnostic.file}${line}${column}`;
}

export type PanelBoxProps = {
  readonly panel: DevPanel;
  readonly focused: boolean;
  readonly title: string;
  readonly bottomTitle?: string;
  readonly body?: string;
  readonly children?: JSX.Element;
  readonly wide: boolean;
  readonly stacked?: boolean;
  readonly onFocus: () => void;
  readonly onScroll?: () => void;
};

export function PanelBox(props: PanelBoxProps) {
  const focusedBorderColor = () => props.wide ? theme.color.focusedPanelBorder : theme.color.workspaceBorder;
  return (
    <box
      id={`panel-${props.panel}`}
      border
      borderStyle="rounded"
      borderColor={props.focused ? focusedBorderColor() : theme.color.border}
      focusedBorderColor={focusedBorderColor()}
      focused={props.focused}
      focusable
      flexGrow={props.stacked === true ? 1 : 0}
      width={props.stacked === true ? "100%" : props.wide ? (props.panel === "contract" ? "50%" : props.panel === "files" ? 28 : 24) : "100%"}
      height={props.stacked === true ? "auto" : props.wide ? "100%" : 5}
      {...(props.stacked === true && props.wide ? { minHeight: 6 } : {})}
      title={props.title}
      {...(props.bottomTitle === undefined ? {} : { bottomTitle: props.bottomTitle })}
      bottomTitleAlignment="right"
      onMouseDown={props.onFocus}
      onMouseScroll={props.onScroll ?? (() => {})}
    >
      {props.children ?? <text selectable content={props.body ?? ""} />}
    </box>
  );
}

export type FeedScrollProps = {
  readonly entries: readonly string[];
};

export function FeedScroll(props: FeedScrollProps) {
  let feedScrollbox: ScrollBoxRenderable | undefined;

  createEffect(() => {
    void props.entries.length;
    feedScrollbox?.scrollTo({ x: 0, y: Math.max(0, feedScrollbox.scrollHeight) });
  });

  return (
    <scrollbox
      id="feed-scrollbox"
      ref={(scrollbox) => {
        feedScrollbox = scrollbox;
      }}
      width="100%"
      height="100%"
      scrollY
      scrollX={false}
      stickyScroll
      stickyStart="bottom"
      verticalScrollbarOptions={theme.scrollbar.vertical}
      contentOptions={{ flexDirection: "column" }}
    >
      {props.entries.map((entry) => (
        <text width="100%" selectable fg={feedEntryColor(entry)} content={entry} wrapMode="word" />
      ))}
    </scrollbox>
  );
}
