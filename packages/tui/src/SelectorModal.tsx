/** @jsxImportSource @opentui/solid */
import type { ColorInput, ScrollBoxRenderable } from "@opentui/core";
import { createEffect, createMemo } from "solid-js";
import { SolidityCodePreview } from "./SolidityCodePreview";
import { theme } from "./theme";

export type SelectorOption = {
  readonly name: string;
  readonly label: string;
  readonly active: boolean;
  readonly badge?: string;
  readonly titleParts?: readonly SelectorOptionPart[];
  readonly detailParts?: readonly SelectorOptionPart[];
  readonly description?: string;
  readonly meta?: string;
  readonly copyValue?: string;
  readonly previewInfoRows?: readonly (readonly SelectorOptionPart[])[];
  readonly previewLines?: readonly string[];
  readonly searchText?: string;
};

export type SelectorOptionPart = {
  readonly text: string;
  readonly kind?: "text" | "muted" | "selected" | "address" | "balance" | "code" | "warning" | "danger";
};

export type SelectorModalProps = {
  readonly id: string;
  readonly inputId: string;
  readonly optionIdPrefix: string;
  readonly title: string;
  readonly hint: string;
  readonly searchPlaceholder: string;
  readonly query: string;
  readonly options: readonly SelectorOption[];
  readonly selectedIndex: number;
  readonly left: number;
  readonly top: number;
  readonly width: number | `${number}%`;
  readonly height?: number;
  readonly zIndex?: number;
  readonly searchFocused?: boolean;
  readonly showPreview?: boolean;
  readonly previewInfoTitle?: string;
  readonly previewCodeTitle?: string;
  readonly onQueryChange: (query: string) => void;
  readonly onSelect: (index: number) => void;
};

export function SelectorModal(props: SelectorModalProps) {
  let optionsScrollbox: ScrollBoxRenderable | undefined;
  const height = () => props.height ?? 12;
  const bodyHeight = () => Math.max(5, height() - 5);
  const modalWidth = () => typeof props.width === "number" ? props.width : 80;
  const bodyWidth = () => Math.max(20, modalWidth() - 4);
  const listPanelWidth = () => props.showPreview ? Math.max(24, Math.floor((bodyWidth() - 1) * 0.38)) : "100%";
  const previewPanelWidth = () => Math.max(24, bodyWidth() - Number(listPanelWidth()) - 1);
  const optionRowId = (index: number) => `${props.optionIdPrefix}-option-row-${index}`;
  const selectedOption = createMemo(() => props.options[props.selectedIndex]);
  const selectedPreviewInfoRows = createMemo(() => selectedOption()?.previewInfoRows ?? []);
  const selectedPreviewLines = createMemo(() => selectedOption()?.previewLines ?? defaultPreviewLines(selectedOption()));
  const previewTitle = createMemo(() => selectedOption()?.label ?? selectedOption()?.badge ?? "");
  const hasMeta = (option: SelectorOption) =>
    option.detailParts !== undefined || option.meta !== undefined || option.description !== undefined;

  createEffect(() => {
    void props.selectedIndex;
    void props.options.length;
    optionsScrollbox?.scrollChildIntoView(optionRowId(props.selectedIndex));
  });

  return (
    <box
      id={props.id}
      position="absolute"
      zIndex={props.zIndex ?? 20}
      top={props.top}
      left={props.left}
      width={props.width}
      height={height()}
      border
      borderStyle="rounded"
      borderColor={theme.color.modalBorder}
      backgroundColor={theme.color.surface}
      title={props.title}
      bottomTitle={props.hint}
      bottomTitleAlignment="right"
      flexDirection="column"
      rowGap={0}
      paddingX={1}
    >
      <box
        id={`${props.optionIdPrefix}-search-panel`}
        border
        borderStyle="rounded"
        borderColor={theme.color.border}
        height={3}
        paddingX={1}
        marginBottom={0}
      >
        <input
          id={props.inputId}
          focused={props.searchFocused ?? true}
          value={props.query}
          placeholder={props.searchPlaceholder}
          backgroundColor={theme.color.surface}
          textColor={theme.color.text}
          focusedBackgroundColor={theme.color.surface}
          focusedTextColor={theme.color.text}
          placeholderColor={theme.color.muted}
          onInput={props.onQueryChange}
        />
      </box>
      <box width="100%" height={bodyHeight()} flexDirection="row" columnGap={1}>
        <box
          id={`${props.optionIdPrefix}-list-panel`}
          border
          borderStyle="rounded"
          borderColor={theme.color.border}
          width={listPanelWidth()}
          height="100%"
        >
          <scrollbox
            id={`${props.optionIdPrefix}-options-scrollbox`}
            ref={(scrollbox) => {
              optionsScrollbox = scrollbox;
            }}
            width="100%"
            height="100%"
            scrollY
            scrollX={false}
            verticalScrollbarOptions={theme.scrollbar.vertical}
            contentOptions={{ flexDirection: "column" }}
          >
            {props.options.map((option, index) => (
              <box
                id={optionRowId(index)}
                width="100%"
                height={hasMeta(option) ? 2 : 1}
                backgroundColor={props.selectedIndex === index ? theme.color.selectionBg : theme.color.surface}
                onMouseDown={() => {
                  props.onSelect(index);
                }}
                flexDirection="column"
              >
                <OptionTitle option={option} selected={props.selectedIndex === index} />
                {hasMeta(option) ? (
                  <OptionDetail option={option} selected={props.selectedIndex === index} />
                ) : null}
              </box>
            ))}
          </scrollbox>
        </box>
        {props.showPreview ? (
          <box
            id={`${props.optionIdPrefix}-preview`}
            border
            borderStyle="rounded"
            borderColor={theme.color.border}
            width={previewPanelWidth()}
            height="100%"
            flexDirection="column"
            title={previewTitle()}
          >
            <scrollbox
              id={`${props.optionIdPrefix}-preview-scrollbox`}
              width="100%"
              height="100%"
              scrollY
              scrollX={false}
              verticalScrollbarOptions={theme.scrollbar.vertical}
              contentOptions={{ flexDirection: "column" }}
            >
              <PreviewInfoBlock rows={selectedPreviewInfoRows()} title={props.previewInfoTitle ?? ""} />
              <ShowPreviewHeading visible={selectedPreviewInfoRows().length > 0} title={props.previewCodeTitle ?? ""} />
              <SolidityCodePreview lines={selectedPreviewLines()} />
            </scrollbox>
          </box>
        ) : null}
      </box>
    </box>
  );
}

function PreviewInfoBlock(props: { readonly rows: readonly (readonly SelectorOptionPart[])[]; readonly title: string }) {
  if (props.rows.length === 0) {
    return null;
  }

  return (
    <>
      <text fg={theme.color.accent} content={props.title} />
      {props.rows.map((row) => (
        <box height={1} flexDirection="row">
          {row.map((part) => (
            <text flexShrink={0} fg={selectorPartColor(part, false)} content={part.text} wrapMode="none" />
          ))}
        </box>
      ))}
      <box height={1} />
    </>
  );
}

function ShowPreviewHeading(props: { readonly visible: boolean; readonly title: string }) {
  return props.visible ? <text fg={theme.color.accent} content={props.title} /> : null;
}

function OptionTitle(props: { readonly option: SelectorOption; readonly selected: boolean }) {
  if (props.option.titleParts === undefined) {
    return (
      <text
        width="100%"
        fg={props.selected ? theme.color.selected : theme.color.text}
        content={optionTitle(props.option, props.selected)}
        wrapMode="none"
      />
    );
  }

  const badge = props.option.badge === undefined ? "" : `[${props.option.badge}] `;
  return (
    <box width="100%" height={1} flexDirection="row">
      <text
        flexShrink={0}
        fg={props.selected ? theme.color.selected : theme.color.text}
        content={`${props.selected ? "›" : " "} ${badge}`}
        wrapMode="none"
      />
      {props.option.titleParts.map((part) => (
        <text flexShrink={0} fg={selectorPartColor(part, props.selected)} content={part.text} wrapMode="none" />
      ))}
    </box>
  );
}

function OptionDetail(props: { readonly option: SelectorOption; readonly selected: boolean }) {
  if (props.option.detailParts === undefined) {
    return (
      <text
        width="100%"
        fg={props.selected ? theme.color.text : theme.color.muted}
        content={optionMeta(props.option)}
        wrapMode="none"
      />
    );
  }

  return (
    <box width="100%" height={1} flexDirection="row">
      <text flexShrink={0} fg={theme.color.muted} content="  " wrapMode="none" />
      {props.option.detailParts.map((part) => (
        <text flexShrink={0} fg={selectorPartColor(part, props.selected)} content={part.text} wrapMode="none" />
      ))}
    </box>
  );
}

function selectorPartColor(part: SelectorOptionPart, selected: boolean): ColorInput {
  if (selected && (part.kind === undefined || part.kind === "text")) {
    return theme.color.text;
  }

  switch (part.kind) {
    case "address":
      return theme.color.code;
    case "balance":
      return theme.color.read;
    case "selected":
      return theme.color.selected;
    case "code":
      return theme.color.code;
    case "warning":
      return theme.color.warning;
    case "danger":
      return theme.color.danger;
    case "muted":
      return theme.color.muted;
    case "text":
    case undefined:
      return theme.color.text;
  }

  return theme.color.text;
}

function defaultPreviewLines(option: SelectorOption | undefined): readonly string[] {
  if (option === undefined) {
    return [];
  }

  const [sourceFile, contract] = option.label.split(":");
  return [
    option.label,
    ...(contract === undefined ? [] : [contract]),
    ...(sourceFile === undefined ? [] : [sourceFile]),
  ];
}

function optionTitle(option: SelectorOption, selected: boolean): string {
  const prefix = selected ? "›" : " ";
  const badge = option.badge === undefined ? "" : `[${option.badge}] `;
  const label = option.label.includes(".sol") ? compactPath(option.label) : option.label;
  return `${prefix} ${badge}${label}`;
}

function optionMeta(option: SelectorOption): string {
  const source = compactSolidityTarget(option.description ?? option.label);
  const meta = option.meta ?? "";
  const description = option.description ?? "";
  if (option.badge === undefined && option.label.endsWith(".sol")) {
    return `  ${meta}${meta.length === 0 || description.length === 0 ? "" : " · "}${description}`;
  }

  if (source !== "") {
    const contract = contractFromTarget(option.description) ?? contractFromMeta(meta);
    return `  ${source}${contract === "" ? "" : ` · ${contract}`}`;
  }

  return `  ${meta}${meta.length === 0 || description.length === 0 ? "" : " · "}${description}`;
}

function compactPath(value: string): string {
  const parts = value.split("/").filter((part) => part.length > 0);
  return parts.length <= 2 ? value : parts[parts.length - 1] ?? value;
}

function compactSolidityTarget(value: string): string {
  const source = value.split(":")[0] ?? "";
  return source.endsWith(".sol") ? compactPath(source) : "";
}

function contractFromTarget(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parts = value.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : undefined;
}

function contractFromMeta(value: string): string {
  return value.includes("/") || value.endsWith(".sol") ? "" : value;
}
