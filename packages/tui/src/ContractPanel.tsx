/** @jsxImportSource @opentui/solid */
import type { DevSession, DevSourceTarget, FunctionItem } from "@consol/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createEffect, For } from "solid-js";
import { groupedFunctions, visibleContractActionFunctions } from "./dev-function-model";
import type { DevDeployedContract, DevStateSnapshot } from "./runtime-types";
import { panelPathValueRows, PanelInfoBlock, PanelPathValue } from "./PanelInfoBlock";
import { selectedBoxBackground, theme } from "./theme";
import { displaySourceFile } from "./DevShellLabels";
import { functionKindColor, shortValue, type Translate } from "./panel-format";
import { declarationKindMessageKey, targetTabLabel } from "./dev-selector-options";

export type ContractDetailsProps = {
  readonly session: DevSession | undefined;
  readonly stateSnapshot?: DevStateSnapshot;
  readonly fallback: string;
  readonly translate: Translate;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly selectedSourceFile: string | null;
  readonly selectedFunctionIndex: number;
  readonly selectedSourceTargetIndex: number;
  readonly hideNoArgReadActions: boolean;
  readonly activeDeployedContract: DevDeployedContract | null;
  readonly deployedContracts: readonly DevDeployedContract[];
  readonly onFunctionSelect?: (index: number) => void;
  readonly onFunctionOpen?: (index: number) => void;
  readonly onSourceTargetSelect?: (index: number) => void;
};

export function ContractDetails(props: ContractDetailsProps) {
  let contractActionsScrollbox: ScrollBoxRenderable | undefined;
  const targets = () => contractTargets(props.session, props.selectedSourceFile);
  const primaryTargets = () => primaryContractTargets(targets());
  const nonDeployableCount = () => targets().filter((target) => target.deployable === false).length;
  const targetRows = () => contractTabRows(primaryTargets(), props.contentWidth, props.translate);
  const activeFunctions = () =>
    visibleContractActionFunctions(props.activeDeployedContract?.functions ?? [], {
      hideNoArgReadActions: props.hideNoArgReadActions,
    });
  const currentFile = () => props.session === undefined ? "-" : props.selectedSourceFile ?? displaySourceFile(props.session) ?? props.session.target;
  const currentFileRows = () => panelPathValueRows(currentFile(), props.contentWidth);
  const showInfoBlockDividers = () => props.contentHeight >= 34;
  const spaciousHeader = () => props.contentWidth >= 44 && props.contentHeight >= 28;
  const headerSeparatorRows = () => showInfoBlockDividers() ? 2 : spaciousHeader() ? 2 : 0;
  const activeContractLabel = () =>
    props.activeDeployedContract === null
      ? props.translate("tui.contract.noDeployedSelected")
      : `${props.activeDeployedContract.contract} ${shortValue(props.activeDeployedContract.address)}`;

  createEffect(() => {
    const functionItem = activeFunctions()[props.selectedFunctionIndex];
    if (functionItem === undefined) {
      return;
    }
    contractActionsScrollbox?.scrollChildIntoView(contractFunctionRowId(functionItem, props.selectedFunctionIndex));
  });

  return (
    <>
      {props.session === undefined ? (
        <text content={props.fallback} />
      ) : (
        <box width="100%" height="100%" flexDirection="column" rowGap={0}>
          <box
            height={contractHeaderHeight(targetRows().length, currentFileRows(), nonDeployableCount(), props.session.deployable === false, headerSeparatorRows())}
            flexDirection="column"
            rowGap={showInfoBlockDividers() ? 0 : spaciousHeader() ? 1 : 0}
          >
            <PanelInfoBlock title={props.translate("tui.contract.currentFileHeading")} hint={props.translate("tui.contract.filePickerHint")} bottomBorder={showInfoBlockDividers()}>
              <PanelPathValue path={currentFile()} rows={currentFileRows()} />
            </PanelInfoBlock>
            <PanelInfoBlock title={props.translate("tui.contract.selectContract")} hint={props.translate("tui.contract.sourceContractPickerHint")} bottomBorder={showInfoBlockDividers()}>
              <ContractTargetTabs
                rows={targetRows()}
                selectedSourceTargetIndex={props.selectedSourceTargetIndex}
                translate={props.translate}
                {...(props.onSourceTargetSelect === undefined ? {} : { onSourceTargetSelect: props.onSourceTargetSelect })}
              />
              <For each={targets().filter((target) => target.deployable === false)}>
                {(target) => (
                  <text
                    fg={theme.color.muted}
                    content={`${target.contract}  ${props.translate(declarationKindMessageKey[target.declarationKind ?? "contract"])}`}
                    wrapMode="word"
                  />
                )}
              </For>
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
              {props.session.deployable === false ? (
                <text
                  fg={theme.color.warning}
                  content={props.translate("tui.contract.notDeployable", { reason: props.session.deployReason ?? "not deployable" })}
                  wrapMode="word"
                />
              ) : null}
            </PanelInfoBlock>
            <PanelInfoBlock title={props.translate("tui.contract.deployedContract")} hint={props.translate("tui.contract.deployedPickerHint")}>
              <text
                fg={props.activeDeployedContract === null ? theme.color.muted : theme.color.read}
                content={activeContractLabel()}
                wrapMode="none"
              />
            </PanelInfoBlock>
          </box>
          <scrollbox
            id="contract-actions-scrollbox"
            ref={(scrollbox) => {
              contractActionsScrollbox = scrollbox;
            }}
            width="100%"
            flexGrow={1}
            scrollY
            scrollX={false}
            verticalScrollbarOptions={theme.scrollbar.vertical}
            contentOptions={{ flexDirection: "column", rowGap: 0 }}
          >
            {props.activeDeployedContract === null ? (
              <text fg={theme.color.muted} content={props.translate("tui.contract.noDeployedActions")} wrapMode="word" />
            ) : activeFunctions().length === 0 ? (
              <text fg={theme.color.muted} content={props.translate("tui.function.filteredEmpty")} wrapMode="word" />
            ) : (
              groupedFunctions(activeFunctions()).map((group) => (
                <>
                  <box height={1} flexDirection="row">
                    <text fg={functionKindColor(group.kind)} content={props.translate(group.titleKey)} />
                    {group.kind === "read" ? <text fg={theme.color.muted} content={`  ${props.translate("tui.function.group.readHint")}`} /> : null}
                  </box>
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
      id={contractFunctionRowId(props.functionItem, props.index)}
      height={2}
      paddingX={1}
      onMouseDown={() => {
        if (props.selected) {
          props.onOpen?.(props.index);
          return;
        }
        props.onSelect?.(props.index);
      }}
      flexDirection="column"
      {...selectedBoxBackground(props.selected)}
    >
      <text
        fg={props.selected ? theme.color.selected : functionKindColor(props.functionItem.kind)}
        content={`${props.selected ? ">" : " "} [${functionBadge(props.functionItem.kind, props.translate)}] ${props.functionItem.signature}`}
        wrapMode="none"
      />
      <text
        fg={props.selected ? theme.color.text : theme.color.muted}
        content={`  ${functionShape(props.functionItem, props.translate)}`}
        wrapMode="none"
      />
    </box>
  );
}

function contractFunctionRowId(functionItem: FunctionItem, index: number): string {
  return `contract-function-${functionItem.name}-${index}`;
}

type IndexedSourceTarget = DevSourceTarget & { readonly index: number };

function ContractTargetTabs(props: {
  readonly rows: readonly (readonly IndexedSourceTarget[])[];
  readonly selectedSourceTargetIndex: number;
  readonly translate: Translate;
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
            const active = target.index === props.selectedSourceTargetIndex;
            const label = targetTabLabel(target, props.translate);
            const tabWidth = label.length + 2;
            return (
              <box
                height={1}
                width={tabWidth}
                {...selectedBoxBackground(active)}
                onMouseDown={() => {
                  props.onSourceTargetSelect?.(target.index);
                }}
              >
                <text
                  fg={active ? theme.color.selected : target.deployable === false ? theme.color.danger : theme.color.muted}
                  content={` ${label} `}
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
  sourceFileRows: number,
  nonDeployableRows: number,
  notDeployable: boolean,
  separatorRows: number,
): number {
  const tabHeight = Math.max(1, rowCount * 2 - 1);
  return sourceFileRows + 6 + tabHeight + separatorRows + nonDeployableRows + (notDeployable ? 1 : 0);
}

function contractTabRows(targets: readonly IndexedSourceTarget[], contentWidth: number, translate: Translate): readonly (readonly IndexedSourceTarget[])[] {
  const maxWidth = Math.max(12, contentWidth - 4);
  const rows: IndexedSourceTarget[][] = [];
  let current: IndexedSourceTarget[] = [];
  let currentWidth = 0;
  for (const target of targets) {
    const width = targetTabLabel(target, translate).length + 2;
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

function contractTargets(session: DevSession | undefined, selectedSourceFile: string | null): readonly IndexedSourceTarget[] {
  const sourceFile = selectedSourceFile ?? displaySourceFile(session);
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
              {...selectedBoxBackground(props.selectedSourceTargetIndex === index)}
              onMouseDown={() => {
                props.onSourceFileSelect?.(index);
              }}
            >
              <text
                content={`${props.selectedSourceTargetIndex === index ? "›" : " "} ${sourceTarget.target}`}
              />
            </box>
          ))}
        </scrollbox>
      )}
    </>
  );
}
