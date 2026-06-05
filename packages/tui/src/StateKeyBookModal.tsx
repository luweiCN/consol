/** @jsxImportSource @opentui/solid */
import type { MessageKey } from "@consol/i18n";
import type { ModalRect } from "./modal-layout";
import { theme } from "./theme";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export type StateKeyBookField = "key" | "label";

export function StateKeyBookModal(props: {
  readonly rect: ModalRect;
  readonly translate: Translate;
  readonly keyType: string;
  readonly keyText: string;
  readonly labelText: string;
  readonly activeField: StateKeyBookField;
  readonly error?: string;
  readonly onKeyChange: (value: string) => void;
  readonly onLabelChange: (value: string) => void;
}) {
  const t = props.translate;
  return (
    <box
      id="state-key-book-modal"
      position="absolute"
      zIndex={42}
      top={props.rect.top}
      left={props.rect.left}
      width={props.rect.width}
      height={Math.min(props.rect.height, 14)}
      border
      borderStyle="rounded"
      borderColor={theme.color.modalBorder}
      backgroundColor={theme.color.surface}
      title={t("tui.state.keyBook.add")}
      bottomTitle={t("tui.state.keyBook.hint")}
      bottomTitleAlignment="right"
      flexDirection="column"
      paddingX={1}
      rowGap={0}
    >
      <text fg={theme.color.muted} content={`${t("tui.state.detail.type")}: ${props.keyType}`} />
      <text fg={theme.color.muted} content={`${t("tui.state.keyBook.key")}:`} />
      <box
        border
        borderStyle="rounded"
        borderColor={props.activeField === "key" ? theme.color.focusedPanelBorder : theme.color.border}
        height={3}
        paddingX={1}
      >
        <input
          id="state-key-book-key-input"
          focused={props.activeField === "key"}
          value={props.keyText}
          placeholder={t("tui.state.keyBook.keyPlaceholder")}
          backgroundColor={theme.color.surface}
          textColor={theme.color.text}
          focusedBackgroundColor={theme.color.surface}
          focusedTextColor={theme.color.text}
          placeholderColor={theme.color.muted}
          onInput={props.onKeyChange}
        />
      </box>
      <text fg={theme.color.muted} content={`${t("tui.state.keyBook.label")}:`} />
      <box
        border
        borderStyle="rounded"
        borderColor={props.activeField === "label" ? theme.color.focusedPanelBorder : theme.color.border}
        height={3}
        paddingX={1}
      >
        <input
          id="state-key-book-label-input"
          focused={props.activeField === "label"}
          value={props.labelText}
          placeholder={t("tui.state.keyBook.labelPlaceholder")}
          backgroundColor={theme.color.surface}
          textColor={theme.color.text}
          focusedBackgroundColor={theme.color.surface}
          focusedTextColor={theme.color.text}
          placeholderColor={theme.color.muted}
          onInput={props.onLabelChange}
        />
      </box>
      {props.error === undefined ? null : <text selectable fg={theme.color.danger} content={props.error} wrapMode="word" />}
    </box>
  );
}
