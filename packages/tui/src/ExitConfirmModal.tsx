/** @jsxImportSource @opentui/solid */
import type { MessageKey } from "@consol/i18n";
import type { ModalRect } from "./modal-layout";
import { theme } from "./theme";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function ExitConfirmModal(props: {
  readonly translate: Translate;
  readonly rect: ModalRect;
}) {
  return (
    <box
      id="exit-confirm-modal"
      position="absolute"
      zIndex={35}
      top={props.rect.top}
      left={props.rect.left}
      width={props.rect.width}
      height={7}
      border
      borderStyle="rounded"
      borderColor={theme.color.borderFocus}
      backgroundColor={theme.color.surface}
      title={props.translate("tui.exit.confirm.title")}
      bottomTitle={props.translate("tui.exit.confirm.hint")}
      bottomTitleAlignment="right"
      flexDirection="column"
      paddingX={1}
    >
      <text fg={theme.color.text} content={props.translate("tui.exit.confirm.message")} wrapMode="word" />
    </box>
  );
}
