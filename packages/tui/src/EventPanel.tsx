/** @jsxImportSource @opentui/solid */
import type { DevContractEventRecord, DevDeployedContract } from "./runtime-types";
import { selectedBoxBackground, selectedReadableColor, theme } from "./theme";
import { eventArgsText, shortRaw, shortValue, transactionTime, type Translate } from "./panel-format";

export type EventsDetailsProps = {
  readonly records: readonly DevContractEventRecord[];
  readonly fallback: string;
  readonly translate: Translate;
  readonly selectedIndex: number;
  readonly activeDeployedContract: DevDeployedContract | null;
};

export function EventsDetails(props: EventsDetailsProps) {
  const visibleRecords = () =>
    props.activeDeployedContract === null
      ? props.records
      : props.records.filter((record) =>
        record.address === null || record.address.toLowerCase() === props.activeDeployedContract?.address.toLowerCase(),
      );

  return (
    <scrollbox
      id="events-scrollbox"
      width="100%"
      height="100%"
      scrollY
      scrollX={false}
      verticalScrollbarOptions={theme.scrollbar.vertical}
      contentOptions={{ flexDirection: "column", rowGap: 1 }}
    >
      {visibleRecords().length === 0 ? (
        <text fg={theme.color.muted} content={props.fallback} />
      ) : (
        visibleRecords().map((record, index) => (
          <EventRecordRow
            record={record}
            selected={props.selectedIndex === index}
            translate={props.translate}
          />
        ))
      )}
    </scrollbox>
  );
}

function EventRecordRow(props: {
  readonly record: DevContractEventRecord;
  readonly selected: boolean;
  readonly translate: Translate;
}) {
  const eventName = props.record.event ?? props.translate("tui.events.unknown");
  const args = eventArgsText(props.record.args);
  const secondaryColor = () => selectedReadableColor(props.selected, theme.color.muted);
  return (
    <box
      minHeight={Math.max(4, args.length === 0 ? 4 : 5)}
      paddingX={1}
      flexDirection="column"
      {...selectedBoxBackground(props.selected)}
    >
      <text
        selectable
        fg={props.selected ? theme.color.selected : theme.color.read}
        content={`${props.selected ? ">" : " "} ${eventTime(props.record.createdAtUnix)} ${props.record.contract}.${eventName}`}
        wrapMode="word"
      />
      <text
        selectable
        fg={secondaryColor()}
        content={`  ${props.translate("tui.events.source")}: ${props.record.source} | ${props.translate("tui.transactions.block")}: ${props.record.blockNumber ?? "-"}`}
        wrapMode="word"
      />
      <text
        selectable
        fg={theme.color.code}
        content={`  ${props.translate("tui.transactions.tx")}: ${shortValue(props.record.txHash)} | ${props.translate("tui.transactions.to")}: ${shortValue(props.record.address)}`}
        wrapMode="word"
      />
      {args.length === 0 ? null : <text selectable fg={theme.color.text} content={`  ${args}`} wrapMode="word" />}
      {props.record.raw === null ? null : <text selectable fg={secondaryColor()} content={`  raw: ${shortRaw(props.record.raw)}`} wrapMode="word" />}
    </box>
  );
}

function eventTime(createdAtUnix: number): string {
  return transactionTime(createdAtUnix);
}
