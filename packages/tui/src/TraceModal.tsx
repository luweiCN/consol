/** @jsxImportSource @opentui/solid */
import type { MessageKey } from "@consol/i18n";
import type { ModalRect } from "./modal-layout";
import { theme } from "./theme";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function TraceModal(props: {
  readonly trace: string;
  readonly translate: Translate;
  readonly rect: ModalRect;
}) {
  const lines = () => {
    const all = props.trace.length === 0 ? [props.translate("tui.trace.empty")] : props.trace.split("\n");
    const max = Math.max(1, props.rect.height - 3);
    return all.length > max ? [...all.slice(0, max - 1), props.translate("tui.trace.truncated")] : all;
  };
  return (
    <box
      id="trace-modal"
      position="absolute"
      zIndex={30}
      top={props.rect.top}
      left={props.rect.left}
      width={props.rect.width}
      height={props.rect.height}
      border
      borderStyle="rounded"
      borderColor={theme.color.borderFocus}
      backgroundColor={theme.background.overlay}
      title={props.translate("tui.trace.title")}
      bottomTitle={props.translate("tui.trace.closeHint")}
      bottomTitleAlignment="right"
      flexDirection="column"
      paddingX={1}
    >
      {lines().map((line) => (
        <text fg={theme.color.text} content={line} />
      ))}
    </box>
  );
}
