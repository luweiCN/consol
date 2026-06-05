/** @jsxImportSource @opentui/solid */
import type { DevStorageStateRowSnapshot } from "./runtime-types";
import { theme } from "./theme";

export function StateStorageRowLine(props: {
  readonly row: DevStorageStateRowSnapshot;
  readonly selected: boolean;
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
      minHeight={1}
      paddingX={1}
      flexDirection="column"
      {...(props.selected ? { backgroundColor: theme.color.buttonBg } : {})}
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
