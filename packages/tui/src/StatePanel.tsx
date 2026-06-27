/** @jsxImportSource @opentui/solid */
import type { FunctionItem } from "@consol/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createEffect } from "solid-js";
import type { DevDeployedContract, DevStateSnapshot, DevStateValueSnapshot } from "./runtime-types";
import { StateItemRow, StateStorageRowLine } from "./StateRows";
import { theme } from "./theme";
import { statusColor, type Translate } from "./panel-format";

export type StateDetailsProps = {
  readonly snapshot: DevStateSnapshot | undefined;
  readonly fallback: string;
  readonly translate: Translate;
  readonly activeDeployedContract: DevDeployedContract | null;
  readonly showRawValues: boolean;
  readonly selectedRowIndex?: number;
  readonly onRowSelect?: (index: number) => void;
};

export function StateDetails(props: StateDetailsProps) {
  let stateScrollbox: ScrollBoxRenderable | undefined;
  let lastScrolledStateRowIndex = -1;
  let lastStateScrollScope = "";
  const readerFunctions = () =>
    props.activeDeployedContract?.functions.filter((item) => (item.kind === "read") && item.inputs.length === 0) ?? [];
  const statusText = () => stateStatusText(props.snapshot, props.translate);
  const selectedRowIndex = () => props.selectedRowIndex ?? -1;

  createEffect(() => {
    const scope = stateScrollScope(props.snapshot, props.activeDeployedContract);
    if (scope !== lastStateScrollScope) {
      lastStateScrollScope = scope;
      lastScrolledStateRowIndex = -1;
    }

    const index = selectedRowIndex();
    if (index < 0 || index === lastScrolledStateRowIndex) {
      return;
    }

    lastScrolledStateRowIndex = index;
    stateScrollbox?.scrollChildIntoView(stateRowId(index));
  });

  return (
    <box width="100%" height="100%" flexDirection="column" rowGap={0}>
      {props.snapshot === undefined ? (
        <scrollbox
          id="state-fallback-scrollbox"
          width="100%"
          height="100%"
          scrollY
          scrollX={false}
          verticalScrollbarOptions={theme.scrollbar.vertical}
          contentOptions={{ flexDirection: "column" }}
        >
          <text fg={theme.color.muted} content={props.fallback} />
          {readerFunctions().map((item) => (
            <text fg={theme.color.text} content={`${item.name}  ${item.outputs.map((output) => output.kind).join(",") || "raw"}`} wrapMode="word" />
          ))}
        </scrollbox>
      ) : (
        <scrollbox
          id="state-details-scrollbox"
          ref={(scrollbox) => {
            stateScrollbox = scrollbox;
          }}
          width="100%"
          height="100%"
          scrollY
          scrollX={false}
          verticalScrollbarOptions={theme.scrollbar.vertical}
          contentOptions={{ flexDirection: "column" }}
        >
          <text selectable fg={statusColor(props.snapshot.status.status)} content={statusText()} wrapMode="word" />
          {props.snapshot.address === null ? null : (
            <text selectable fg={theme.color.code} content={`${props.translate("tui.state.address")}: ${props.snapshot.address}`} wrapMode="word" />
          )}
          {(props.snapshot.details ?? []).map((detail) => (
            <text selectable fg={theme.color.muted} content={`${props.translate(detail.labelKey)}: ${detail.value}`} wrapMode="word" />
          ))}
          {props.snapshot.values.length === 0 && (props.snapshot.storageValues?.length ?? 0) === 0 ? (
            <>
              <text fg={theme.color.muted} content={props.translate("tui.state.empty")} />
              <StateReaderHints readers={readerFunctions()} translate={props.translate} />
            </>
          ) : (
            <>
              {props.snapshot.values.map((value, index) => (
                <StateValueLine
                  id={stateRowId(index)}
                  value={value}
                  index={index}
                  selected={selectedRowIndex() === index}
                  translate={props.translate}
                  showRawValue={props.showRawValues}
                  {...(props.onRowSelect === undefined ? {} : { onSelect: props.onRowSelect })}
                />
              ))}
              {(props.snapshot.storageValues ?? []).map((row, storageIndex) => {
                const index = (props.snapshot?.values.length ?? 0) + storageIndex;
                return (
                  <StateStorageRowLine
                    id={stateRowId(index)}
                    row={row}
                    index={index}
                    selected={selectedRowIndex() === index}
                    translate={props.translate}
                    {...(props.onRowSelect === undefined ? {} : { onSelect: props.onRowSelect })}
                  />
                );
              })}
              {(props.snapshot.storageHints ?? []).map((hint) => (
                <text selectable fg={theme.color.muted} content={hint} wrapMode="word" />
              ))}
            </>
          )}
        </scrollbox>
      )}
    </box>
  );
}

function stateRowId(index: number): string {
  return `state-row-${index}`;
}

function stateScrollScope(snapshot: DevStateSnapshot | undefined, activeDeployedContract: DevDeployedContract | null): string {
  return snapshot?.address ?? activeDeployedContract?.address ?? "";
}

function stateStatusText(snapshot: DevStateSnapshot | undefined, translate: Translate): string {
  if (snapshot === undefined) {
    return translate("tui.state.loading");
  }

  if (snapshot.status.status === "deployment_not_found") {
    return translate("tui.state.notDeployed");
  }

  if (snapshot.status.status === "deployment_stale") {
    return translate("tui.state.staleDeployment");
  }

  return snapshot.status.message ?? snapshot.status.status;
}

function StateReaderHints(props: { readonly readers: readonly FunctionItem[]; readonly translate: Translate }) {
  if (props.readers.length === 0) {
    return <text fg={theme.color.muted} content={props.translate("tui.state.noReaders")} wrapMode="word" />;
  }

  return (
    <>
      <text fg={theme.color.muted} content={props.translate("tui.state.readers")} wrapMode="word" />
      {props.readers.map((item) => (
        <text fg={theme.color.text} content={`  ${item.name}  ${item.outputs.map((output) => output.kind).join(",") || "raw"}`} wrapMode="word" />
      ))}
    </>
  );
}

function StateValueLine(props: {
  readonly value: DevStateValueSnapshot;
  readonly translate: Translate;
  readonly showRawValue: boolean;
  readonly selected: boolean;
  readonly id?: string;
  readonly index?: number;
  readonly onSelect?: (index: number) => void;
}) {
  const error = () => props.value.error?.trim();
  const hasError = () => {
    const value = error();
    return value !== undefined && value.length > 0;
  };
  const rawVisible = () => !hasError() && props.showRawValue;
  const typeLabel = () => props.value.output_types.length === 0 ? props.translate("tui.state.raw") : props.value.output_types.join(",");
  const decodedValue = () => props.value.readable?.trim() || props.value.raw || "-";
  return (
    <StateItemRow
      {...(props.id === undefined ? {} : { id: props.id })}
      title={props.value.name}
      titleMeta={typeLabel()}
      titleColor={hasError() ? theme.color.danger : theme.color.read}
      selected={props.selected}
      minHeight={props.showRawValue ? (rawVisible() ? 4 : 3) : 2}
      fields={hasError()
        ? [{ label: props.translate("tui.state.error"), value: error() ?? "-" }]
        : [{ label: props.translate("tui.state.decoded"), value: decodedValue() }]}
      detailFields={[
        ...(props.showRawValue ? [{ label: props.translate("tui.state.signature"), value: props.value.signature }] : []),
        ...(rawVisible() ? [{ label: props.translate("tui.state.raw"), value: props.value.raw }] : []),
      ]}
      {...(props.index === undefined ? {} : { index: props.index })}
      {...(props.onSelect === undefined ? {} : { onSelect: props.onSelect })}
    />
  );
}
