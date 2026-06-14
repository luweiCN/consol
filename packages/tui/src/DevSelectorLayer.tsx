/** @jsxImportSource @opentui/solid */
import type { MessageKey } from "@consol/i18n";
import { PickerActionMenu, type PickerActionOption } from "./PickerActionMenu";
import { SelectorModal, type SelectorOption } from "./SelectorModal";

export type DevNetworkOption = SelectorOption;

export type DevAccountOption = SelectorOption;

export type EntrySelectorType = "source" | "workspace";

export type SelectorKind = "network" | "account" | "source" | "deployed" | "events-filter" | "entry";

export type ActiveSelector =
  | { readonly kind: "none" }
  | {
      readonly kind: SelectorKind;
      readonly query: string;
      readonly selectedIndex: number;
      readonly ignoreOpenerInput: boolean;
    };

export type DevSelectorLayerProps = {
  readonly selector: ActiveSelector;
  readonly preview: boolean;
  readonly modalLeft: number;
  readonly modalTop: number;
  readonly modalWidth: number;
  readonly modalHeight: number;
  readonly translate: (key: MessageKey, values?: Record<string, string | number>) => string;
  readonly query: (kind: SelectorKind) => string;
  readonly options: readonly SelectorOption[];
  readonly selectedIndex: (kind: SelectorKind) => number;
  readonly actionOptions: readonly PickerActionOption[];
  readonly actionMenuIndex: number | null;
  readonly entrySelectorType?: EntrySelectorType;
  readonly onQueryChange: (query: string) => void;
  readonly onSelect: (index: number) => void;
};

export function DevSelectorLayer(props: DevSelectorLayerProps) {
  return (
    <>
      {props.selector.kind === "network" ? (
      <SelectorModal
        id="modal-chain-selector"
        inputId="chain-filter-input"
        optionIdPrefix="chain"
        title={props.translate("tui.modal.chain.title")}
        hint={props.translate("tui.picker.listHint")}
        searchPlaceholder={props.translate("tui.modal.chain.search")}
        query={props.query("network")}
        options={props.options}
        selectedIndex={props.selectedIndex("network")}
        left={props.modalLeft}
        top={props.modalTop}
        width={props.modalWidth}
        height={props.modalHeight}
        previewInfoTitle={props.translate("tui.modal.preview.info")}
        previewCodeTitle={props.translate("tui.modal.preview.abi")}
        searchFocused={props.actionMenuIndex === null}
        onQueryChange={props.onQueryChange}
        onSelect={props.onSelect}
      />
      ) : null}
      {props.selector.kind === "account" ? (
      <SelectorModal
        id="modal-account-selector"
        inputId="account-filter-input"
        optionIdPrefix="account"
        title={props.translate("tui.modal.account.title")}
        hint={props.translate("tui.picker.listHint")}
        searchPlaceholder={props.translate("tui.modal.account.search")}
        query={props.query("account")}
        options={props.options}
        selectedIndex={props.selectedIndex("account")}
        left={props.modalLeft}
        top={props.modalTop}
        width={props.modalWidth}
        height={props.modalHeight}
        previewInfoTitle={props.translate("tui.modal.preview.info")}
        previewCodeTitle={props.translate("tui.modal.preview.abi")}
        searchFocused={props.actionMenuIndex === null}
        onQueryChange={props.onQueryChange}
        onSelect={props.onSelect}
      />
      ) : null}
      {props.selector.kind === "source" ? (
      <SelectorModal
        id="modal-source-selector"
        inputId="source-filter-input"
        optionIdPrefix="source"
        title={props.translate("tui.modal.source.title")}
        hint={props.translate("tui.picker.listHint")}
        searchPlaceholder={props.translate("tui.modal.source.search")}
        query={props.query("source")}
        options={props.options}
        selectedIndex={props.selectedIndex("source")}
        left={props.modalLeft}
        top={props.modalTop}
        width={props.modalWidth}
        height={props.modalHeight}
        showPreview={props.preview}
        previewInfoTitle={props.translate("tui.modal.preview.info")}
        previewCodeTitle={props.translate("tui.modal.preview.abi")}
        searchFocused={props.actionMenuIndex === null}
        onQueryChange={props.onQueryChange}
        onSelect={props.onSelect}
      />
      ) : null}
      {props.selector.kind === "deployed" ? (
      <SelectorModal
        id="modal-deployed-selector"
        inputId="deployed-filter-input"
        optionIdPrefix="deployed"
        title={props.translate("tui.modal.deployed.title")}
        hint={props.translate("tui.picker.listHint")}
        searchPlaceholder={props.translate("tui.modal.deployed.search")}
        query={props.query("deployed")}
        options={props.options}
        selectedIndex={props.selectedIndex("deployed")}
        left={props.modalLeft}
        top={props.modalTop}
        width={props.modalWidth}
        height={props.modalHeight}
        showPreview={props.preview}
        previewInfoTitle={props.translate("tui.modal.preview.info")}
        previewCodeTitle={props.translate("tui.modal.preview.abi")}
        searchFocused={props.actionMenuIndex === null}
        onQueryChange={props.onQueryChange}
        onSelect={props.onSelect}
      />
      ) : null}
      {props.selector.kind === "events-filter" ? (
      <SelectorModal
        id="modal-events-filter-selector"
        inputId="events-filter-input"
        optionIdPrefix="events-filter"
        title={props.translate("tui.modal.eventsFilter.title")}
        hint={props.translate("tui.modal.eventsFilter.hint")}
        searchPlaceholder={props.translate("tui.modal.eventsFilter.search")}
        query={props.query("events-filter")}
        options={props.options}
        selectedIndex={props.selectedIndex("events-filter")}
        left={props.modalLeft}
        top={props.modalTop}
        width={props.modalWidth}
        height={props.modalHeight}
        searchFocused={props.actionMenuIndex === null}
        onQueryChange={props.onQueryChange}
        onSelect={props.onSelect}
      />
      ) : null}
      {props.selector.kind === "entry" ? (
      <SelectorModal
        id="modal-entry-selector"
        inputId="entry-filter-input"
        optionIdPrefix="entry"
        title={props.translate(props.entrySelectorType === "workspace" ? "tui.modal.workspace.title" : "tui.modal.source.title")}
        hint={props.translate("tui.picker.listHint")}
        searchPlaceholder={props.translate(
          props.entrySelectorType === "workspace" ? "tui.modal.workspace.search" : "tui.modal.source.search",
        )}
        query={props.query("entry")}
        options={props.options}
        selectedIndex={props.selectedIndex("entry")}
        left={props.modalLeft}
        top={props.modalTop}
        width={props.modalWidth}
        height={props.modalHeight}
        showPreview={props.preview}
        previewInfoTitle={props.translate("tui.modal.preview.info")}
        previewCodeTitle={props.translate("tui.modal.preview.abi")}
        searchFocused={props.actionMenuIndex === null}
        onQueryChange={props.onQueryChange}
        onSelect={props.onSelect}
      />
      ) : null}
      {props.selector.kind !== "none" && props.actionMenuIndex !== null ? (
        <PickerActionMenu
          id="selector-action-menu"
          title={props.translate("tui.picker.actions")}
          hintKey="tui.picker.actionHint"
          translate={props.translate}
          options={props.actionOptions}
          selectedIndex={props.actionMenuIndex}
          top={props.modalTop + 5}
          left={props.modalLeft + Math.max(2, Math.floor(props.modalWidth / 2) - 15)}
          width={30}
        />
      ) : null}
    </>
  );
}
