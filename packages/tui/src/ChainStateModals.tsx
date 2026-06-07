/** @jsxImportSource @opentui/solid */
import type { MessageKey } from "@consol/i18n";
import type { ModalRect } from "./modal-layout";
import { SelectorModal, type SelectorOption } from "./SelectorModal";
import { theme } from "./theme";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function ChainStateSaveModal(props: {
  readonly rect: ModalRect;
  readonly translate: Translate;
  readonly name: string;
  readonly error?: string;
  readonly onNameChange: (value: string) => void;
  readonly onSubmit: () => void;
}) {
  const t = props.translate;
  return (
    <box
      id="chain-state-save-modal"
      position="absolute"
      zIndex={42}
      top={props.rect.top}
      left={props.rect.left}
      width={props.rect.width}
      height={9}
      border
      borderStyle="rounded"
      borderColor={theme.color.modalBorder}
      backgroundColor={theme.background.overlay}
      title={t("tui.chainState.save.title")}
      bottomTitle={t("tui.chainState.save.hint")}
      bottomTitleAlignment="right"
      flexDirection="column"
      paddingX={1}
      rowGap={0}
    >
      <text fg={theme.color.muted} content={t("tui.chainState.save.name")} />
      <box border borderStyle="rounded" borderColor={theme.color.focusedPanelBorder} height={3} paddingX={1}>
        <input
          id="chain-state-save-name-input"
          focused
          value={props.name}
          placeholder={t("tui.chainState.save.placeholder")}
          textColor={theme.color.text}
          focusedTextColor={theme.color.text}
          placeholderColor={theme.color.muted}
          onInput={props.onNameChange}
          onSubmit={props.onSubmit}
        />
      </box>
      {props.error === undefined ? null : <text selectable fg={theme.color.danger} content={props.error} wrapMode="word" />}
    </box>
  );
}

export function ChainStatePickerModal(props: {
  readonly rect: ModalRect;
  readonly translate: Translate;
  readonly query: string;
  readonly options: readonly SelectorOption[];
  readonly selectedIndex: number;
  readonly onQueryChange: (value: string) => void;
  readonly onSelect: (index: number) => void;
}) {
  const t = props.translate;
  return (
    <SelectorModal
      id="chain-state-picker-modal"
      inputId="chain-state-filter-input"
      optionIdPrefix="chain-state"
      title={t("tui.chainState.restore.title")}
      hint={t("tui.chainState.restore.hint")}
      searchPlaceholder={t("tui.chainState.restore.search")}
      query={props.query}
      options={props.options.length === 0 ? emptyOptions(t) : props.options}
      selectedIndex={props.selectedIndex}
      left={props.rect.left}
      top={props.rect.top}
      width={props.rect.width}
      height={Math.min(props.rect.height, 18)}
      zIndex={42}
      searchFocused
      onQueryChange={props.onQueryChange}
      onSelect={props.onSelect}
    />
  );
}

function emptyOptions(t: Translate): readonly SelectorOption[] {
  return [{ name: "empty", label: t("tui.chainState.restore.empty"), active: false }];
}
