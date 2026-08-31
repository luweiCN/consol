/** @jsxImportSource @opentui/solid */
import type { JSX } from "solid-js";
import { theme } from "./theme";

export function TopTabPanel(props: {
  readonly title: string;
  readonly bottomTitle?: string;
  readonly children: JSX.Element;
  readonly focused?: boolean;
}) {
  return (
    <box
      id={`top-tab-${props.title.toLowerCase()}`}
      flexGrow={1}
      border
      borderStyle="rounded"
      borderColor={props.focused === true ? theme.color.focusedPanelBorder : theme.color.border}
      title={props.title}
      {...(props.bottomTitle === undefined ? {} : { bottomTitle: props.bottomTitle })}
      bottomTitleAlignment="right"
    >
      {props.children}
    </box>
  );
}
