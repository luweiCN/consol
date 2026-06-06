/** @jsxImportSource @opentui/solid */
import type { MessageKey } from "@consol/i18n";
import type { ModalRect } from "./modal-layout";
import { PickerActionMenu, type PickerActionOption } from "./PickerActionMenu";
import { SelectorModal, type SelectorOption } from "./SelectorModal";
import { theme } from "./theme";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export type StateKeyBookField = "key" | "label";
export type StateKeyBookAction = "add" | "edit" | "delete";

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
  readonly onSubmit: () => void;
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
      backgroundColor={theme.background.overlay}
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
              textColor={theme.color.text}
              focusedTextColor={theme.color.text}
              placeholderColor={theme.color.muted}
              onInput={props.onKeyChange}
              onSubmit={props.onSubmit}
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
          textColor={theme.color.text}
          focusedTextColor={theme.color.text}
          placeholderColor={theme.color.muted}
          onInput={props.onLabelChange}
          onSubmit={props.onSubmit}
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
  readonly actions: readonly PickerActionOption[];
  readonly actionMenuIndex: number | null;
  readonly onQueryChange: (query: string) => void;
}) {
  const t = props.translate;
  return (
    <>
      <SelectorModal
        id="state-key-book-list-modal"
        inputId="state-key-book-filter-input"
        optionIdPrefix="state-key-book"
        title={`${t("tui.state.keyBook.title")} (${props.keyType})`}
        hint={t("tui.state.keyBook.listHint")}
        searchPlaceholder={t("tui.state.keyBook.search")}
        query={props.query}
        options={stateKeyBookOptions(props.entries, t)}
        selectedIndex={props.selectedIndex}
        left={props.rect.left}
        top={props.rect.top}
        width={props.rect.width}
        height={Math.min(props.rect.height, 18)}
        zIndex={40}
        searchFocused={props.actionMenuIndex === null}
        onQueryChange={props.onQueryChange}
        onSelect={() => {}}
      />
      {props.actionMenuIndex === null ? null : (
        <PickerActionMenu
          id="state-key-book-action-menu"
          title={t("tui.state.keyBook.actions")}
          hintKey="tui.picker.actionHint"
          translate={t}
          options={props.actions}
          selectedIndex={props.actionMenuIndex}
          top={props.rect.top + 5}
          left={props.rect.left + Math.max(2, Math.floor(props.rect.width / 2) - 14)}
          width={28}
          zIndex={41}
        />
      )}
    </>
  );
}

function stateKeyBookOptions(entries: readonly StateKeyBookListEntry[], t: Translate): readonly SelectorOption[] {
  if (entries.length === 0) {
    return [{ name: "empty", label: t("tui.state.keyBook.noKeys"), active: false, meta: "" }];
  }
  return entries.map((entry) => ({
    name: `${entry.type}:${entry.value}`,
    label: entry.label ?? t("tui.state.keyBook.unlabeled"),
    active: false,
    badge: entry.type,
    meta: shortKeyValue(entry.value),
    searchText: `${entry.label ?? ""} ${entry.value} ${entry.type}`,
  }));
}

function shortKeyValue(value: string): string {
  return value.length <= 58 ? value : `${value.slice(0, 24)}...${value.slice(-16)}`;
}
