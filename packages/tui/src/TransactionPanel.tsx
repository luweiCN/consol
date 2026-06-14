/** @jsxImportSource @opentui/solid */
import type { ScrollBoxRenderable } from "@opentui/core";
import { createEffect } from "solid-js";
import type { DevTransactionRecord } from "./runtime-types";
import { JsonCodeBlock } from "./JsonCodeBlock";
import { selectedBoxBackground, selectedReadableColor, theme } from "./theme";
import {
  transactionDetailEntries,
  transactionFieldLines,
  transactionStatusColor,
  transactionStatusLabel,
  transactionTitle,
  transactionTitleColor,
  type TransactionField,
  type Translate,
} from "./panel-format";

export type TransactionsDetailsProps = {
  readonly records: readonly DevTransactionRecord[];
  readonly fallback: string;
  readonly translate: Translate;
  readonly selectedIndex: number;
  readonly onRecordSelect?: (index: number) => void;
  readonly onRecordOpen?: (index: number) => void;
};

export function TransactionsDetails(props: TransactionsDetailsProps) {
  let transactionsScrollbox: ScrollBoxRenderable | undefined;

  createEffect(() => {
    void props.selectedIndex;
    void props.records.length;
    transactionsScrollbox?.scrollChildIntoView(transactionRecordId(props.selectedIndex));
  });

  return (
    <scrollbox
      id="transactions-scrollbox"
      ref={(scrollbox) => {
        transactionsScrollbox = scrollbox;
      }}
      width="100%"
      height="100%"
      scrollY
      scrollX={false}
      verticalScrollbarOptions={theme.scrollbar.vertical}
      contentOptions={{ flexDirection: "column", rowGap: 1 }}
    >
      {props.records.length === 0 ? (
        <text fg={theme.color.muted} content={props.fallback} />
      ) : (
        props.records.map((record, index) => (
          <TransactionRecordRow
            record={record}
            index={index}
            ordinal={props.records.length - index}
            selected={props.selectedIndex === index}
            translate={props.translate}
            {...(props.onRecordSelect === undefined ? {} : { onSelect: props.onRecordSelect })}
            {...(props.onRecordOpen === undefined ? {} : { onOpen: props.onRecordOpen })}
          />
        ))
      )}
    </scrollbox>
  );
}

function TransactionRecordRow(props: {
  readonly record: DevTransactionRecord;
  readonly index: number;
  readonly ordinal: number;
  readonly selected: boolean;
  readonly translate: Translate;
  readonly onSelect?: (index: number) => void;
  readonly onOpen?: (index: number) => void;
}) {
  const lines = transactionFieldLines(props.record, props.translate);

  return (
    <box
      id={transactionRecordId(props.index)}
      minHeight={Math.max(4, Math.min(8, lines.length + 1))}
      paddingX={1}
      flexDirection="column"
      {...selectedBoxBackground(props.selected)}
      onMouseDown={() => {
        props.onSelect?.(props.index);
      }}
    >
      <TransactionTitleLine record={props.record} ordinal={props.ordinal} selected={props.selected} translate={props.translate} />
      {lines.map((line) => (
        <TransactionFieldLine fields={line.fields} selected={props.selected} />
      ))}
    </box>
  );
}

function TransactionTitleLine(props: {
  readonly record: DevTransactionRecord;
  readonly ordinal: number;
  readonly selected: boolean;
  readonly translate: Translate;
}) {
  const titleColor = props.selected ? theme.color.selected : transactionTitleColor(props.record);
  const status = transactionStatusLabel(props.record, props.translate);
  return (
    <box height={1} flexDirection="row">
      <text
        selectable
        fg={titleColor}
        content={`${props.selected ? ">" : " "} [${props.ordinal}] ${transactionTitle(props.record)} `}
        wrapMode="none"
      />
      <text
        selectable
        fg={transactionStatusColor(props.record)}
        content={`[${status}]`}
        wrapMode="none"
      />
    </box>
  );
}

function TransactionFieldLine(props: { readonly fields: readonly TransactionField[]; readonly selected: boolean }) {
  return (
    <box height={1} flexDirection="row">
      <text selectable fg={selectedReadableColor(props.selected, theme.color.muted)} content="  " />
      {props.fields.map((field, index) => (
        <>
          {index === 0 ? null : <text selectable fg={selectedReadableColor(props.selected, theme.color.border)} content=" | " />}
          <text selectable fg={selectedReadableColor(props.selected, theme.color.muted)} content={`${field.label}: `} />
          <text selectable fg={props.selected ? theme.color.text : field.fg} content={field.value} wrapMode="none" />
        </>
      ))}
    </box>
  );
}

function transactionRecordId(index: number): string {
  return `transaction-record-${index}`;
}

export function TransactionDetailModal(props: {
  readonly record: DevTransactionRecord;
  readonly translate: Translate;
  readonly rect: { readonly top: number; readonly left: number; readonly width: number; readonly height: number };
}) {
  const entries = () => transactionDetailEntries(props.record, props.translate);

  return (
    <box
      id="transaction-detail-modal"
      position="absolute"
      zIndex={35}
      top={props.rect.top}
      left={props.rect.left}
      width={props.rect.width}
      height={props.rect.height}
      border
      borderStyle="rounded"
      borderColor={theme.color.modalBorder}
      backgroundColor={theme.background.overlay}
      title={props.translate("tui.transactions.detail.title")}
      bottomTitle={props.translate("tui.transactions.detail.hint")}
      bottomTitleAlignment="right"
      flexDirection="column"
    >
      <scrollbox
        id="transaction-detail-scrollbox"
        width="100%"
        height="100%"
        scrollY
        scrollX={false}
        verticalScrollbarOptions={theme.scrollbar.vertical}
        contentOptions={{ flexDirection: "column", rowGap: 0 }}
      >
        {entries().map((entry) => (
          entry.kind === "json"
            ? <JsonCodeBlock lines={entry.lines} wrapColumn={Math.max(16, props.rect.width - 8)} />
            : <text selectable fg={entry.fg} content={entry.content} wrapMode="word" />
        ))}
      </scrollbox>
    </box>
  );
}

export function transactionDetailText(record: DevTransactionRecord, translate: Translate): string {
  return transactionDetailEntries(record, translate)
    .flatMap((entry) => entry.kind === "json" ? entry.lines : [entry.content])
    .join("\n")
    .trim();
}
