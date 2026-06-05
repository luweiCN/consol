/** @jsxImportSource @opentui/solid */
import type { MessageKey } from "@consol/i18n";
import type { ModalRect } from "./modal-layout";
import { theme } from "./theme";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export type StateKeyBookField = "key" | "label";
export type StateKeyBookAction = "edit" | "delete";

export type StateKeyBookListEntry = {
  readonly type: string;
  readonly value: string;
  readonly label: string | null;
};

export function StateKeyBookModal(props: {
  readonly rect: ModalRect;
  readonly translate: Translate;
  readonly mode: "add" | "edit";
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
      title={t(props.mode === "edit" ? "tui.state.keyBook.edit" : "tui.state.keyBook.add")}
      bottomTitle={t("tui.state.keyBook.hint")}
      bottomTitleAlignment="right"
      flexDirection="column"
      paddingX={1}
      rowGap={0}
    >
      <text fg={theme.color.muted} content={`${t("tui.state.detail.type")}: ${props.keyType}`} />
      <text fg={theme.color.muted} content={`${t("tui.state.keyBook.key")}:`} />
      {props.mode === "edit"
        ? <text selectable fg={theme.color.text} content={props.keyText} wrapMode="word" />
        : (
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
        )}
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

export function StateKeyBookListModal(props: {
  readonly rect: ModalRect;
  readonly translate: Translate;
  readonly keyType: string;
  readonly entries: readonly StateKeyBookListEntry[];
  readonly selectedIndex: number;
  readonly query: string;
  readonly searchActive: boolean;
  readonly actionMenuIndex: number | null;
}) {
  const t = props.translate;
  const actionOptions: readonly StateKeyBookAction[] = ["edit", "delete"];
  const bottomTitle = props.actionMenuIndex !== null
    ? t("tui.state.keyBook.actionHint")
    : props.searchActive
      ? t("tui.state.keyBook.searchHint")
      : t("tui.state.keyBook.listHint");
  return (
    <box
      id="state-key-book-list-modal"
      position="absolute"
      zIndex={40}
      top={props.rect.top}
      left={props.rect.left}
      width={props.rect.width}
      height={Math.min(props.rect.height, 18)}
      border
      borderStyle="rounded"
      borderColor={theme.color.modalBorder}
      backgroundColor={theme.color.surface}
      title={`${t("tui.state.keyBook.title")} (${props.keyType})`}
      bottomTitle={bottomTitle}
      bottomTitleAlignment="right"
      flexDirection="column"
      paddingX={1}
      rowGap={0}
    >
      <text
        fg={props.searchActive ? theme.color.accent : theme.color.muted}
        content={`${t("tui.state.keyBook.search")}: ${props.query.length === 0 ? t("tui.state.keyBook.searchEmpty") : props.query}`}
        wrapMode="none"
      />
      <box flexDirection="column" height={props.actionMenuIndex === null ? "100%" : Math.max(4, props.rect.height - 8)}>
        {props.entries.length === 0
          ? <text fg={theme.color.muted} content={t("tui.state.keyBook.noKeys")} />
          : props.entries.map((entry, index) => (
            <box height={2} flexDirection="column" backgroundColor={index === props.selectedIndex ? theme.color.selectionBg : theme.color.surface}>
              <box height={1} flexDirection="row">
                <text fg={index === props.selectedIndex ? theme.color.selected : theme.color.read} content={`${index === props.selectedIndex ? "> " : "  "}${entry.label ?? t("tui.state.keyBook.unlabeled")}`} wrapMode="none" />
                <text fg={theme.color.type} content={` (${entry.type})`} wrapMode="none" />
              </box>
              <text selectable fg={theme.color.muted} content={`  ${shortKeyValue(entry.value)}`} wrapMode="none" />
            </box>
          ))}
      </box>
      {props.actionMenuIndex === null ? null : (
        <box border borderStyle="rounded" borderColor={theme.color.border} flexDirection="column" height={5} paddingX={1}>
          <text fg={theme.color.muted} content={t("tui.state.keyBook.actions")} />
          {actionOptions.map((action, index) => (
            <text
              fg={index === props.actionMenuIndex ? theme.color.selected : theme.color.text}
              content={`${index === props.actionMenuIndex ? "> " : "  "}${t(action === "edit" ? "tui.state.keyBook.editLabel" : "tui.state.keyBook.delete")}`}
            />
          ))}
        </box>
      )}
    </box>
  );
}

function shortKeyValue(value: string): string {
  return value.length <= 58 ? value : `${value.slice(0, 24)}...${value.slice(-16)}`;
}
