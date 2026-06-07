/** @jsxImportSource @opentui/solid */
import { createMemo, Show, type JSX } from "solid-js";
import { theme } from "./theme";

export type PanelInfoBlockProps = {
  readonly title: string;
  readonly hint?: string;
  readonly bottomBorder?: boolean;
  readonly children?: JSX.Element;
};

const panelInfoBlockDivider = "─".repeat(240);

export function PanelInfoBlock(props: PanelInfoBlockProps) {
  return (
    <box width="100%" flexDirection="column" rowGap={0}>
      <box height={1} flexDirection="row">
        <text fg={theme.color.accent} content={props.title} wrapMode="none" />
        {props.hint === undefined ? null : <text fg={theme.color.muted} content={`  ${props.hint}`} wrapMode="none" />}
      </box>
      {props.children}
      {props.bottomBorder === true ? <text width="100%" height={1} fg={theme.color.border} content={panelInfoBlockDivider} wrapMode="none" /> : null}
    </box>
  );
}

export function PanelPathValue(props: { readonly path: string; readonly rows: number }) {
  const parts = createMemo(() => pathParts(props.path));

  return (
    <Show
      when={props.rows > 1}
      fallback={
        parts().prefix.length === 0
          ? <text height={1} fg={theme.color.code} content={parts().name} wrapMode="none" />
          : (
            <box height={1} flexDirection="row">
              <text fg={theme.color.muted} content={parts().prefix} wrapMode="none" />
              <text fg={theme.color.code} content={parts().name} wrapMode="none" />
            </box>
          )
      }
    >
      <box height={props.rows} flexDirection="column" rowGap={0}>
        {parts().prefix.length === 0 ? null : <text height={1} fg={theme.color.muted} content={parts().prefix} wrapMode="char" />}
        <text height={1} fg={theme.color.code} content={parts().name} wrapMode="char" />
      </box>
    </Show>
  );
}

export function panelPathValueRows(path: string, contentWidth: number): number {
  return path.length > Math.max(12, contentWidth) ? 2 : 1;
}

function pathParts(path: string): { readonly prefix: string; readonly name: string } {
  const slashIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slashIndex < 0
    ? { prefix: "", name: path }
    : { prefix: path.slice(0, slashIndex + 1), name: path.slice(slashIndex + 1) };
}
