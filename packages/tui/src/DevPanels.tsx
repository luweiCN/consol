/** @jsxImportSource @opentui/solid */
import type { DevPanel, DevSession, DevSourceTarget, FunctionItem } from "@consol/core";
import type { MessageKey } from "@consol/i18n";
import type { ColorInput, ScrollBoxRenderable } from "@opentui/core";
import { createEffect, Show, type Accessor, type JSX } from "solid-js";
import { groupedFunctions } from "./dev-function-model";
import type {
  DevBuildDiagnosticsSnapshot,
  DevContractEventRecord,
  DevDeployedContract,
  DevStateSnapshot,
  DevStateValueSnapshot,
  DevTransactionRecord,
} from "./runtime-types";
import { theme } from "./theme";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export type ContractDetailsProps = {
  readonly session: DevSession | undefined;
  readonly stateSnapshot?: DevStateSnapshot;
  readonly fallback: string;
  readonly translate: Translate;
  readonly contentWidth: number;
  readonly selectedFunctionIndex: number;
  readonly selectedSourceTargetIndex: number;
  readonly activeDeployedContract: DevDeployedContract | null;
  readonly deployedContracts: readonly DevDeployedContract[];
  readonly onFunctionSelect?: (index: number) => void;
  readonly onFunctionOpen?: (index: number) => void;
  readonly onSourceTargetSelect?: (index: number) => void;
};

export function ContractDetails(props: ContractDetailsProps) {
  const targets = () => contractTargets(props.session);
  const primaryTargets = () => primaryContractTargets(targets());
  const nonDeployableCount = () => targets().filter((target) => target.deployable === false).length;
  const targetRows = () => contractTabRows(primaryTargets(), props.contentWidth);
  const activeFunctions = () => props.activeDeployedContract?.functions ?? [];
  const currentFile = () => props.session === undefined ? "-" : basename(displaySourceFile(props.session) ?? props.session.target);
  const spaciousHeader = () => props.contentWidth >= 44;
  const activeContractLabel = () =>
    props.activeDeployedContract === null
      ? props.translate("tui.contract.noDeployedSelected")
      : `${props.activeDeployedContract.contract} ${shortValue(props.activeDeployedContract.address)}`;

  return (
    <>
      {props.session === undefined ? (
        <text content={props.fallback} />
      ) : (
        <box width="100%" height="100%" flexDirection="column" rowGap={0}>
          <box
            height={contractHeaderHeight(targetRows().length, nonDeployableCount() > 0, props.session.deployable === false, spaciousHeader())}
            flexDirection="column"
            rowGap={0}
          >
            <box height={1} flexDirection="row">
              <text fg={theme.color.accent} content={props.translate("tui.contract.currentFileHeading")} />
              <text fg={theme.color.muted} content={`  ${props.translate("tui.contract.filePickerHint")}`} />
            </box>
            <text fg={theme.color.code} content={currentFile()} wrapMode="none" />
            <HeaderSpacer visible={spaciousHeader()} />
            <box flexDirection="column" rowGap={0}>
              <text fg={theme.color.accent} content={props.translate("tui.contract.selectContract")} />
              <ContractTargetTabs
                rows={targetRows()}
                contract={props.session.contract}
                selectedSourceTargetIndex={props.selectedSourceTargetIndex}
                {...(props.onSourceTargetSelect === undefined ? {} : { onSourceTargetSelect: props.onSourceTargetSelect })}
              />
              {nonDeployableCount() === 0 ? null : (
                <text
                  fg={theme.color.muted}
                  content={props.translate("tui.contract.nonDeployableDeclarations", { count: nonDeployableCount() })}
                  wrapMode="word"
                />
              )}
            </box>
            <HeaderSpacer visible={spaciousHeader()} />
            <ContractMetricLine
              functions={props.session.abiSummary.functions}
              events={props.session.abiSummary.events}
              errors={props.session.abiSummary.errors}
              translate={props.translate}
            />
            <box height={1} flexDirection="row">
              <text fg={theme.color.muted} content={`${props.translate("tui.contract.constructorLabel")} `} />
              <text
                fg={theme.color.code}
                content={props.session.constructor?.signature ?? "constructor()"}
                wrapMode="none"
              />
            </box>
            <HeaderSpacer visible={spaciousHeader()} />
            <box height={1} flexDirection="row">
              <text fg={theme.color.muted} content={`${props.translate("tui.contract.deployedContract")}: `} />
              <text
                fg={props.activeDeployedContract === null ? theme.color.muted : theme.color.read}
                content={activeContractLabel()}
                wrapMode="none"
              />
            </box>
            <text
              fg={theme.color.muted}
              content={props.translate("tui.contract.deployedPickerHint")}
              wrapMode="word"
            />
            {props.session.deployable === false ? (
              <text
                fg={theme.color.warning}
                content={props.translate("tui.contract.notDeployable", { reason: props.session.deployReason ?? "not deployable" })}
                wrapMode="word"
              />
            ) : null}
          </box>
          <scrollbox
            id="contract-actions-scrollbox"
            width="100%"
            height="100%"
            scrollY
            scrollX={false}
            verticalScrollbarOptions={theme.scrollbar.vertical}
            contentOptions={{ flexDirection: "column", rowGap: 0 }}
          >
            {props.activeDeployedContract === null ? (
              <text fg={theme.color.muted} content={props.translate("tui.contract.noDeployedSelected")} wrapMode="word" />
            ) : (
              groupedFunctions(activeFunctions()).map((group) => (
                <>
                  <text fg={functionKindColor(group.kind)} content={props.translate(group.titleKey)} />
                  {group.rows.map((row) => (
                    <FunctionActionRow
                      functionItem={row.function}
                      index={row.index}
                      selected={props.selectedFunctionIndex === row.index}
                      translate={props.translate}
                      {...(props.onFunctionSelect === undefined ? {} : { onSelect: props.onFunctionSelect })}
                      {...(props.onFunctionOpen === undefined ? {} : { onOpen: props.onFunctionOpen })}
                    />
                  ))}
                </>
              ))
            )}
          </scrollbox>
        </box>
      )}
    </>
  );
}

function HeaderSpacer(props: { readonly visible: boolean }) {
  return props.visible ? <box height={1} /> : null;
}

function ContractMetricLine(props: {
  readonly functions: number;
  readonly events: number;
  readonly errors: number;
  readonly translate: Translate;
}) {
  return (
    <box height={1} flexDirection="row">
      <text fg={theme.color.read} content={`${props.functions}`} />
      <text fg={theme.color.muted} content={` ${props.translate("tui.contract.metric.functions")} `} />
      <text fg={theme.color.border} content="| " />
      <text fg={theme.color.payable} content={`${props.events}`} />
      <text fg={theme.color.muted} content={` ${props.translate("tui.contract.metric.events")} `} />
      <text fg={theme.color.border} content="| " />
      <text fg={props.errors === 0 ? theme.color.muted : theme.color.danger} content={`${props.errors}`} />
      <text fg={theme.color.muted} content={` ${props.translate("tui.contract.metric.errors")}`} />
    </box>
  );
}

function FunctionActionRow(props: {
  readonly functionItem: FunctionItem;
  readonly index: number;
  readonly selected: boolean;
  readonly translate: Translate;
  readonly onSelect?: (index: number) => void;
  readonly onOpen?: (index: number) => void;
}) {
  return (
    <box
      id={`contract-function-${props.functionItem.name}-${props.index}`}
      height={2}
      paddingX={1}
      backgroundColor={props.selected ? theme.color.selectionBg : theme.color.buttonBg}
      onMouseDown={() => {
        if (props.selected) {
          props.onOpen?.(props.index);
          return;
        }
        props.onSelect?.(props.index);
      }}
      flexDirection="column"
    >
      <text
        fg={props.selected ? theme.color.selected : functionKindColor(props.functionItem.kind)}
        content={`${props.selected ? ">" : " "} [${functionBadge(props.functionItem.kind, props.translate)}] ${props.functionItem.signature}`}
        wrapMode="none"
      />
      <text fg={props.selected ? theme.color.text : theme.color.muted} content={`  ${functionShape(props.functionItem, props.translate)}`} wrapMode="none" />
    </box>
  );
}

type IndexedSourceTarget = DevSourceTarget & { readonly index: number };

function ContractTargetTabs(props: {
  readonly rows: readonly (readonly IndexedSourceTarget[])[];
  readonly contract: string;
  readonly selectedSourceTargetIndex: number;
  readonly onSourceTargetSelect?: (index: number) => void;
}) {
  if (props.rows.length === 0) {
    return null;
  }

  return (
    <box height={Math.max(1, props.rows.length * 2 - 1)} flexDirection="column" rowGap={1}>
      {props.rows.map((row) => (
        <box height={1} flexDirection="row" columnGap={2}>
          {row.map((target) => {
            const active = target.index === props.selectedSourceTargetIndex || target.contract === props.contract;
            const tabWidth = target.contract.length + 2;
            return (
              <box
                height={1}
                width={tabWidth}
                backgroundColor={active ? theme.color.selectionBg : theme.color.buttonBg}
                onMouseDown={() => {
                  props.onSourceTargetSelect?.(target.index);
                }}
              >
                <text
                  fg={active ? theme.color.selected : target.deployable === false ? theme.color.danger : theme.color.muted}
                  content={` ${target.contract} `}
                  wrapMode="none"
                />
              </box>
            );
          })}
        </box>
      ))}
    </box>
  );
}

function contractHeaderHeight(
  rowCount: number,
  hasNonDeployableDeclarations: boolean,
  notDeployable: boolean,
  spacious: boolean,
): number {
  const tabHeight = Math.max(1, rowCount * 2 - 1);
  return (spacious ? 10 : 7) + tabHeight + (hasNonDeployableDeclarations ? 1 : 0) + (notDeployable ? 1 : 0);
}

function contractTabRows(targets: readonly IndexedSourceTarget[], contentWidth: number): readonly (readonly IndexedSourceTarget[])[] {
  const maxWidth = Math.max(12, contentWidth - 4);
  const rows: IndexedSourceTarget[][] = [];
  let current: IndexedSourceTarget[] = [];
  let currentWidth = 0;
  for (const target of targets) {
    const width = target.contract.length + 2;
    const gap = current.length === 0 ? 0 : 2;
    if (current.length > 0 && currentWidth + gap + width > maxWidth) {
      rows.push(current);
      current = [];
      currentWidth = 0;
    }
    current.push(target);
    currentWidth += (currentWidth === 0 ? 0 : 2) + width;
  }
  if (current.length > 0) {
    rows.push(current);
  }
  return rows.length === 0 ? [targets] : rows;
}

function contractTargets(session: DevSession | undefined): readonly IndexedSourceTarget[] {
  const sourceFile = displaySourceFile(session);
  if (session === undefined || sourceFile === null) {
    return [];
  }

  return session.sourceTargets
    .map((target, index) => ({ ...target, index }))
    .filter((target) => target.sourceFile === sourceFile);
}

function primaryContractTargets(targets: readonly IndexedSourceTarget[]): readonly IndexedSourceTarget[] {
  const deployable = targets.filter((target) => target.deployable !== false);
  return deployable.length === 0 ? targets : deployable;
}

function displaySourceFile(session: DevSession | undefined): string | null {
  if (session === undefined) {
    return null;
  }

  const targetSource = sourceFileFromTarget(session.target);
  if (targetSource.endsWith(".sol") && session.sourceTargets.some((target) => target.sourceFile === targetSource)) {
    return targetSource;
  }

  if (session.sourceFile !== null) {
    return session.sourceFile;
  }

  if (targetSource.endsWith(".sol")) {
    return targetSource;
  }

  return session.sourceFile;
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter((part) => part.length > 0).at(-1) ?? path;
}

function sourceFileFromTarget(target: string): string {
  return target.split(":")[0] ?? target;
}

function functionBadge(kind: FunctionItem["kind"], translate: Translate): string {
  return kind === "read"
    ? translate("tui.function.badge.read")
    : kind === "payable"
      ? translate("tui.function.badge.payable")
      : translate("tui.function.badge.write");
}

function functionShape(functionItem: FunctionItem, translate: Translate): string {
  const inputs = functionItem.inputs.map((input) => `${input.name || "_"}:${input.kind}`).join(", ") || translate("tui.function.noArgs");
  const outputs = functionItem.outputs.map((output) => output.kind).join(", ") || translate("tui.function.noReturns");
  return `${translate("tui.function.args")}: ${inputs}  ${translate("tui.function.returns")}: ${outputs}`;
}

export type SourceFileListProps = {
  readonly session: DevSession | undefined;
  readonly fallback: string;
  readonly selectedSourceTargetIndex: number;
  readonly onSourceFileSelect?: (index: number) => void;
};

export function SourceFileList(props: SourceFileListProps) {
  return (
    <>
      {props.session === undefined || props.session.sourceTargets.length === 0 ? (
        <text content={props.fallback} />
      ) : (
        <scrollbox
          id="source-file-scrollbox"
          width="100%"
          height="100%"
          scrollY
          scrollX={false}
          verticalScrollbarOptions={theme.scrollbar.vertical}
          contentOptions={{ flexDirection: "column" }}
        >
          {props.session.sourceTargets.map((sourceTarget, index) => (
            <box
              id={`source-file-${index}`}
              height={1}
              onMouseDown={() => {
                props.onSourceFileSelect?.(index);
              }}
            >
              <text content={`${props.selectedSourceTargetIndex === index ? "›" : " "} ${sourceTarget.target}`} />
            </box>
          ))}
        </scrollbox>
      )}
    </>
  );
}

export type StateDetailsProps = {
  readonly snapshot: DevStateSnapshot | undefined;
  readonly fallback: string;
  readonly translate: Translate;
  readonly activeDeployedContract: DevDeployedContract | null;
  readonly showRawValues: boolean;
};

export function StateDetails(props: StateDetailsProps) {
  const readerFunctions = () =>
    props.activeDeployedContract?.functions.filter((item) => (item.kind === "read") && item.inputs.length === 0) ?? [];
  const statusText = () => stateStatusText(props.snapshot, props.translate);

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
          {props.snapshot.values.length === 0 ? (
            <>
              <text fg={theme.color.muted} content={props.translate("tui.state.empty")} />
              <StateReaderHints readers={readerFunctions()} translate={props.translate} />
            </>
          ) : (
            props.snapshot.values.map((value) => <StateValueLine value={value} translate={props.translate} showRawValue={props.showRawValues} />)
          )}
        </scrollbox>
      )}
    </box>
  );
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

function StateValueLine(props: { readonly value: DevStateValueSnapshot; readonly translate: Translate; readonly showRawValue: boolean }) {
  const error = () => props.value.error?.trim();
  const hasError = () => {
    const value = error();
    return value !== undefined && value.length > 0;
  };
  const rawVisible = () => !hasError() && props.showRawValue;
  return (
    <box minHeight={rawVisible() ? 4 : 3} paddingX={1} flexDirection="column" backgroundColor={theme.color.buttonBg}>
      <text
        selectable
        fg={hasError() ? theme.color.danger : theme.color.read}
        content={hasError()
          ? `${props.value.name}  ${props.translate("tui.state.error")}: ${error()}`
          : `${props.value.name}  ${stateValueDisplay(props.value, props.translate)}`}
        wrapMode="word"
      />
      <text selectable fg={theme.color.muted} content={`${props.translate("tui.state.signature")}: ${props.value.signature}`} wrapMode="word" />
      {rawVisible() ? (
        <text selectable fg={theme.color.code} content={`${props.translate("tui.state.raw")}: ${props.value.raw}`} wrapMode="word" />
      ) : null}
    </box>
  );
}

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
      backgroundColor={props.selected ? theme.color.selectionBg : theme.color.buttonBg}
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

type TransactionField = {
  readonly label: string;
  readonly value: string;
  readonly fg: ColorInput;
};

function TransactionFieldLine(props: { readonly fields: readonly TransactionField[]; readonly selected: boolean }) {
  return (
    <box height={1} flexDirection="row">
      <text selectable fg={theme.color.muted} content="  " />
      {props.fields.map((field, index) => (
        <>
          {index === 0 ? null : <text selectable fg={theme.color.border} content=" | " />}
          <text selectable fg={theme.color.muted} content={`${field.label}: `} />
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
  const lines = () => transactionDetailLines(props.record, props.translate);

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
      backgroundColor={theme.color.surface}
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
        {lines().map((line) => (
          <text selectable fg={line.fg} content={line.content} wrapMode="word" />
        ))}
      </scrollbox>
    </box>
  );
}

export function transactionDetailText(record: DevTransactionRecord, translate: Translate): string {
  return transactionDetailLines(record, translate).map((line) => line.content).join("\n").trim();
}

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
  return (
    <box
      minHeight={Math.max(4, args.length === 0 ? 4 : 5)}
      paddingX={1}
      flexDirection="column"
      backgroundColor={props.selected ? theme.color.selectionBg : theme.color.buttonBg}
    >
      <text
        selectable
        fg={props.selected ? theme.color.selected : theme.color.read}
        content={`${props.selected ? ">" : " "} ${eventTime(props.record.createdAtUnix)} ${props.record.contract}.${eventName}`}
        wrapMode="word"
      />
      <text
        selectable
        fg={theme.color.muted}
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
      {props.record.raw === null ? null : <text selectable fg={theme.color.muted} content={`  raw: ${shortRaw(props.record.raw)}`} wrapMode="word" />}
    </box>
  );
}

function eventArgsText(args: readonly DevContractEventRecord["args"][number][]): string {
  return args.map((arg) => `${arg.name || "_"}${arg.indexed ? "*" : ""}=${arg.value}`).join(", ");
}

function eventTime(createdAtUnix: number): string {
  return transactionTime(createdAtUnix);
}

function shortRaw(value: string): string {
  return value.length > 96 ? `${value.slice(0, 96)}...` : value;
}

function transactionTitle(record: DevTransactionRecord): string {
  const functionLabel = record.signature ?? record.functionName ?? "constructor";
  return `${transactionTime(record.createdAtUnix)}  ${record.action.toUpperCase()}  ${record.contract}.${functionLabel}`;
}

function transactionFieldLines(record: DevTransactionRecord, translate: Translate): readonly { readonly fields: readonly TransactionField[] }[] {
  const receipt = [
    field(translate, "tui.transactions.tx", shortValue(record.txHash), theme.color.code),
    field(translate, "tui.transactions.block", record.blockNumber ?? "-", theme.color.text),
    field(translate, "tui.transactions.confirmations", record.confirmations ?? "-", theme.color.text),
    field(translate, "tui.transactions.gasUsed", record.gasUsed ?? "-", theme.color.text),
  ];
  const network = [
    field(translate, "tui.transactions.network", record.network ?? "-", theme.color.text),
    field(translate, "tui.transactions.chain", record.chainId ?? "-", theme.color.text),
    field(translate, "tui.transactions.account", record.account ?? "-", theme.color.text),
    ...(record.networkFingerprint === undefined || record.networkFingerprint === null
      ? []
      : [{ label: "rpc", value: record.networkFingerprint, fg: theme.color.muted }]),
  ];
  const route = [
    field(translate, "tui.transactions.from", shortValue(record.from), theme.color.code),
    field(translate, "tui.transactions.to", shortValue(record.to ?? record.address ?? record.contractAddress), theme.color.code),
    field(translate, "tui.transactions.nonce", record.nonce ?? "-", theme.color.text),
  ];
  const gas = [
    field(translate, "tui.transactions.gasLimit", record.gasLimit ?? "-", theme.color.text),
    field(translate, "tui.transactions.gasPrice", record.gasPrice ?? "-", theme.color.text),
    field(translate, "tui.transactions.maxFee", record.maxFeePerGas ?? "-", theme.color.text),
    field(translate, "tui.transactions.priorityFee", record.maxPriorityFeePerGas ?? "-", theme.color.text),
    field(translate, "tui.transactions.effectiveGasPrice", record.effectiveGasPrice ?? "-", theme.color.text),
    field(translate, "tui.transactions.estimate", record.gasEstimate ?? record.gasEstimateError ?? "-", theme.color.text),
  ];
  const calldata = [
    field(translate, "tui.transactions.calldata", record.calldataPrefix ?? record.input ?? "-", theme.color.code),
    ...(record.calldataHash === undefined || record.calldataHash === null ? [] : [field(translate, "tui.transactions.calldataHash", record.calldataHash, theme.color.code)]),
    ...(record.value === undefined || record.value === null ? [] : [field(translate, "tui.transactions.value", record.value, theme.color.text)]),
  ];
  const args = record.args.length === 0 ? [] : [field(translate, "tui.transactions.args", record.args.join(", "), theme.color.text)];
  const result = record.result ?? record.rawOutput;

  return [
    { fields: receipt },
    { fields: network },
    { fields: route },
    { fields: gas },
    { fields: calldata },
    ...(args.length === 0 ? [] : [{ fields: args }]),
    ...(record.logs === undefined || record.logs.length === 0 ? [] : [{ fields: [field(translate, "tui.transactions.logs", record.logs.join(", "), theme.color.text)] }]),
    ...(record.events === undefined || record.events.length === 0 ? [] : [{ fields: [field(translate, "tui.transactions.events", eventSummary(record.events), theme.color.read)] }]),
    ...(result === null ? [] : [{ fields: [field(translate, "tui.transactions.result", result, theme.color.text)] }]),
  ];
}

function field(translate: Translate, key: MessageKey, value: string, fg: ColorInput): TransactionField {
  return { label: translate(key), value, fg };
}

function transactionDetailLines(record: DevTransactionRecord, translate: Translate): readonly { readonly fg: ColorInput; readonly content: string }[] {
  const rows = [
    detailRow(translate, "tui.transactions.field.id", record.id),
    detailRow(translate, "tui.transactions.field.action", record.action),
    detailRow(translate, "tui.transactions.field.contract", record.contract),
    detailRow(translate, "tui.transactions.field.target", record.target),
    detailRow(translate, "tui.transactions.field.function", record.functionName),
    detailRow(translate, "tui.transactions.field.signature", record.signature),
    detailRow(translate, "tui.transactions.tx", record.txHash),
    detailRow(translate, "tui.transactions.input", record.input),
    detailRow(translate, "tui.transactions.logs", record.logs === undefined || record.logs.length === 0 ? null : record.logs.join(", ")),
    detailRow(translate, "tui.transactions.events", record.events === undefined || record.events.length === 0 ? null : eventDetailSummary(record.events)),
    detailRow(translate, "tui.transactions.field.timestamp", record.blockTimestamp),
    detailRow(translate, "tui.transactions.block", record.blockNumber),
    detailRow(translate, "tui.transactions.confirmations", record.confirmations),
    detailRow(translate, "tui.transactions.status", transactionStatusLabel(record, translate), transactionStatusColor(record)),
    detailRow(translate, "tui.transactions.gasUsed", record.gasUsed),
    detailRow(translate, "tui.transactions.gasLimit", record.gasLimit),
    detailRow(translate, "tui.transactions.gasPrice", record.gasPrice),
    detailRow(translate, "tui.transactions.maxFee", record.maxFeePerGas),
    detailRow(translate, "tui.transactions.priorityFee", record.maxPriorityFeePerGas),
    detailRow(translate, "tui.transactions.effectiveGasPrice", record.effectiveGasPrice),
    detailRow(translate, "tui.transactions.estimate", record.gasEstimate ?? record.gasEstimateError),
    detailRow(translate, "tui.transactions.network", record.network),
    detailRow(translate, "tui.transactions.chain", record.chainId),
    detailRow(translate, "tui.transactions.account", record.account),
    detailRow(translate, "tui.transactions.from", record.from),
    detailRow(translate, "tui.transactions.to", record.to ?? record.address ?? record.contractAddress),
    detailRow(translate, "tui.transactions.nonce", record.nonce),
    detailRow(translate, "tui.transactions.value", record.value),
    detailRow(translate, "tui.transactions.calldata", record.calldataPrefix),
    detailRow(translate, "tui.transactions.calldataHash", record.calldataHash),
    detailRow(translate, "tui.transactions.args", record.args.length === 0 ? null : record.args.join(", ")),
    detailRow(translate, "tui.transactions.result", record.result),
    detailRow(translate, "tui.transactions.field.rawOutput", record.rawOutput),
    detailRow(translate, "tui.transactions.field.time", transactionTime(record.createdAtUnix)),
  ];

  return [
    { fg: transactionTitleColor(record), content: transactionTitle(record) },
    { fg: theme.color.muted, content: "" },
    ...rows.map((row) => ({ fg: row.value === "-" ? theme.color.muted : row.fg ?? theme.color.text, content: `${row.label}: ${row.value}` })),
  ];
}

function eventSummary(events: readonly DevContractEventRecord[]): string {
  return events.map((event) => event.event ?? event.signature ?? shortRaw(event.raw ?? "raw")).join(", ");
}

function eventDetailSummary(events: readonly DevContractEventRecord[]): string {
  return events
    .map((event) => {
      const name = event.event ?? event.signature ?? "raw";
      const args = eventArgsText(event.args);
      return `${name}${args.length === 0 ? "" : `(${args})`} tx=${shortValue(event.txHash)} block=${event.blockNumber ?? "-"}`;
    })
    .join(" | ");
}

function detailRow(
  translate: Translate,
  key: MessageKey,
  value: string | null | undefined,
  fg?: ColorInput,
): { readonly label: string; readonly value: string; readonly fg?: ColorInput } {
  return {
    label: translate(key),
    value: value === null || value === undefined || value.length === 0 ? "-" : value,
    ...(fg === undefined ? {} : { fg }),
  };
}

type TransactionStatusKind = "none" | "pending" | "sent" | "waiting" | "mined" | "success" | "read" | "reverted" | "failed" | "unknown";

function transactionStatusLabel(record: DevTransactionRecord, translate: Translate): string {
  const kind = transactionStatusKind(record);
  if (kind === "none") {
    return "-";
  }

  if (kind === "unknown") {
    return record.status ?? "-";
  }

  return translate(transactionStatusKey(kind));
}

function transactionStatusKind(record: DevTransactionRecord): TransactionStatusKind {
  const status = record.status?.trim().toLowerCase() ?? "";
  if (status.length === 0) {
    return record.action === "read" && (record.result !== null || record.rawOutput !== null) ? "read" : "none";
  }

  if (status === "pending" || status === "queued") {
    return record.txHash === null ? "pending" : "waiting";
  }

  if (status === "sent" || status === "submitted" || status === "broadcast" || status === "broadcasted") {
    return "sent";
  }

  if (status === "waiting" || status === "waiting_for_block" || status === "waiting_for_receipt" || status === "mining") {
    return "waiting";
  }

  if (status === "mined" || status === "confirmed" || status === "included") {
    return "mined";
  }

  if (status === "success" || status === "ok" || status === "0x1" || status === "1") {
    return record.action === "read" ? "read" : "success";
  }

  if (status === "reverted" || status === "0x0" || status === "0") {
    return "reverted";
  }

  if (status === "failed" || status === "failure" || status === "error") {
    return "failed";
  }

  return "unknown";
}

function transactionStatusKey(kind: Exclude<TransactionStatusKind, "none" | "unknown">): MessageKey {
  switch (kind) {
    case "pending":
      return "tui.transactions.status.pending";
    case "sent":
      return "tui.transactions.status.sent";
    case "waiting":
      return "tui.transactions.status.waiting";
    case "mined":
      return "tui.transactions.status.mined";
    case "success":
      return "tui.transactions.status.success";
    case "read":
      return "tui.transactions.status.read";
    case "reverted":
      return "tui.transactions.status.reverted";
    case "failed":
      return "tui.transactions.status.failed";
  }
}

function transactionTitleColor(record: DevTransactionRecord): ColorInput {
  const action = record.action.toLowerCase();
  if (action === "read" || action === "call") {
    return theme.color.read;
  }

  if (action === "payable") {
    return theme.color.payable;
  }

  return theme.color.write;
}

function transactionStatusColor(record: DevTransactionRecord): ColorInput {
  const status = transactionStatusKind(record);
  if (status === "reverted" || status === "failed") {
    return theme.color.danger;
  }

  if (status === "success" || status === "read" || status === "mined") {
    return theme.color.read;
  }

  return theme.color.write;
}

function shortValue(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length === 0) {
    return "-";
  }

  return value.startsWith("0x") && value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function transactionTime(createdAtUnix: number): string {
  if (!Number.isFinite(createdAtUnix) || createdAtUnix <= 0) {
    return "-";
  }

  const date = new Date(createdAtUnix * 1000);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}`;
}

export type DiagnosticsDetailsProps = {
  readonly snapshot: DevBuildDiagnosticsSnapshot | undefined;
  readonly fallback: string;
  readonly translate: Translate;
};

export function DiagnosticsDetails(props: DiagnosticsDetailsProps) {
  return (
    <Show when={props.snapshot} fallback={<text fg={theme.color.muted} content={props.fallback} />}>
      {(snapshot: Accessor<DevBuildDiagnosticsSnapshot>) => (
        <scrollbox
          id="diagnostics-scrollbox"
          width="100%"
          height="100%"
          scrollY
          scrollX={false}
          verticalScrollbarOptions={theme.scrollbar.vertical}
          contentOptions={{ flexDirection: "column" }}
        >
          <text selectable fg={snapshot().status === "success" ? theme.color.read : theme.color.danger} content={snapshot().message} wrapMode="word" />
          {snapshot().diagnostics.length === 0 ? (
            <text fg={theme.color.muted} content={props.translate("tui.diagnostics.empty")} />
          ) : (
            snapshot().diagnostics.map((diagnostic: DevBuildDiagnosticsSnapshot["diagnostics"][number]) => (
              <box minHeight={3} paddingX={1} flexDirection="column" backgroundColor={theme.color.buttonBg}>
                <text
                  selectable
                  fg={diagnostic.severity === "error" ? theme.color.danger : theme.color.write}
                  content={`${diagnostic.severity}${diagnostic.code === null ? "" : ` ${diagnostic.code}`}`}
                  wrapMode="none"
                />
                <text selectable fg={theme.color.muted} content={diagnosticLocation(diagnostic)} wrapMode="word" />
                <text selectable fg={theme.color.text} content={diagnostic.message} wrapMode="word" />
              </box>
            ))
          )}
        </scrollbox>
      )}
    </Show>
  );
}

function diagnosticLocation(diagnostic: DevBuildDiagnosticsSnapshot["diagnostics"][number]): string {
  if (diagnostic.file === null) {
    return diagnostic.source;
  }

  const line = diagnostic.line === null ? "" : `:${diagnostic.line}`;
  const column = diagnostic.column === null ? "" : `:${diagnostic.column}`;
  return `${diagnostic.file}${line}${column}`;
}

export type PanelBoxProps = {
  readonly panel: DevPanel;
  readonly focused: boolean;
  readonly title: string;
  readonly bottomTitle?: string;
  readonly body?: string;
  readonly children?: JSX.Element;
  readonly wide: boolean;
  readonly stacked?: boolean;
  readonly onFocus: () => void;
  readonly onScroll?: () => void;
};

export function PanelBox(props: PanelBoxProps) {
  return (
    <box
      id={`panel-${props.panel}`}
      border
      borderStyle="rounded"
      borderColor={props.focused ? theme.color.focusedPanelBorder : theme.color.border}
      focused={props.focused}
      focusable
      flexGrow={props.stacked === true ? 1 : 0}
      width={props.stacked === true ? "100%" : props.wide ? (props.panel === "contract" ? "50%" : props.panel === "files" ? 28 : 24) : "100%"}
      height={props.stacked === true ? "auto" : props.wide ? "100%" : 5}
      title={props.title}
      {...(props.bottomTitle === undefined ? {} : { bottomTitle: props.bottomTitle })}
      bottomTitleAlignment="right"
      onMouseDown={props.onFocus}
      onMouseScroll={props.onScroll ?? (() => {})}
    >
      {props.children ?? <text selectable content={props.body ?? ""} />}
    </box>
  );
}

function stateValueDisplay(value: DevStateValueSnapshot, translate: Translate): string {
  const readable = value.readable?.trim();
  const valueText = readable === undefined || readable.length === 0 ? value.raw : readable;
  const typeLabel = value.output_types.length === 0 ? translate("tui.state.raw") : value.output_types.join(",");
  return `${propsDecodedLabel(translate)}: ${valueText} (${typeLabel})`;
}

function propsDecodedLabel(translate: Translate): string {
  return translate("tui.state.decoded");
}

function statusColor(status: string): ColorInput {
  if (status === "ready") {
    return theme.color.read;
  }

  if (status === "deployment_not_found" || status === "deployment_stale") {
    return theme.color.muted;
  }

  return theme.color.danger;
}

export type FeedScrollProps = {
  readonly entries: readonly string[];
};

export function FeedScroll(props: FeedScrollProps) {
  let feedScrollbox: ScrollBoxRenderable | undefined;

  createEffect(() => {
    void props.entries.length;
    feedScrollbox?.scrollTo({ x: 0, y: Math.max(0, feedScrollbox.scrollHeight) });
  });

  return (
    <scrollbox
      id="feed-scrollbox"
      ref={(scrollbox) => {
        feedScrollbox = scrollbox;
      }}
      width="100%"
      height="100%"
      scrollY
      scrollX={false}
      stickyScroll
      stickyStart="bottom"
      verticalScrollbarOptions={theme.scrollbar.vertical}
      contentOptions={{ flexDirection: "column" }}
    >
      {props.entries.map((entry) => (
        <text width="100%" selectable fg={feedEntryColor(entry)} content={entry} wrapMode="word" />
      ))}
    </scrollbox>
  );
}

function functionKindColor(kind: FunctionItem["kind"]): ColorInput {
  return kind === "read" ? theme.color.read : kind === "payable" ? theme.color.payable : theme.color.write;
}

function feedEntryColor(entry: string): ColorInput {
  const lower = entry.toLowerCase();
  if (lower.includes("failed") || lower.includes("失败") || lower.includes("error")) {
    return theme.color.danger;
  }

  if (lower.includes("preview") || lower.includes("预览")) {
    return theme.color.write;
  }

  if (lower.includes("sent") || lower.includes("已发送") || lower.includes("已确认") || lower.includes("ok")) {
    return theme.color.read;
  }

  return theme.color.text;
}
