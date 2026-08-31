/** @jsxImportSource @opentui/solid */
import type { DevSession, FunctionItem } from "@consol/core";
import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core";
import { createEffect, For } from "solid-js";
import { groupedFunctions } from "./dev-function-model";
import type { DevDeployedContract, DevStateSnapshot } from "./runtime-types";
import { panelPathValueRows, PanelInfoBlock, PanelPathValue } from "./PanelInfoBlock";
import { selectedBoxBackground, theme } from "./theme";
import { displaySourceFile } from "./DevShellLabels";
import { functionKindColor, shortValue, type Translate } from "./panel-format";
import { declarationKindMessageKey, targetTabLabel } from "./dev-selector-options";
import { nerdIcon } from "./icons";
import {
  contractHeaderHeight,
  contractMetricRows,
  contractTabRows,
  contractTargets,
  functionActionLines,
  primaryContractTargets,
  type ContractMetric,
  type IndexedSourceTarget,
} from "./contract-panel-model";

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
  readonly activeDeployedContract: DevDeployedContract | null;
  readonly onFunctionSelect?: (index: number) => void;
  readonly onFunctionOpen?: (index: number) => void;
  readonly onFunctionToolsOpen?: (index: number) => void;
  readonly onSourceTargetSelect?: (index: number) => void;
  readonly onFilePickerOpen?: () => void;
  readonly onDeployedPickerOpen?: () => void;
};

export function ContractDetails(props: ContractDetailsProps) {
  let contractActionsScrollbox: ScrollBoxRenderable | undefined;
  const targets = () => contractTargets(props.session, props.selectedSourceFile);
  const primaryTargets = () => primaryContractTargets(targets());
  const nonDeployableCount = () => targets().filter((target) => target.deployable === false).length;
  const targetRows = () => contractTabRows(primaryTargets(), props.contentWidth, props.translate);
  const metricRows = () => contractMetricRows(props.session?.abiSummary, props.contentWidth, props.translate);
  const activeFunctions = () => props.activeDeployedContract?.functions ?? [];
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
            height={contractHeaderHeight(
              targetRows().length,
              currentFileRows(),
              metricRows().length,
              nonDeployableCount(),
              props.session.deployable === false,
              headerSeparatorRows(),
            )}
            flexDirection="column"
            rowGap={showInfoBlockDividers() ? 0 : spaciousHeader() ? 1 : 0}
          >
            <PanelInfoBlock
              title={props.translate("tui.contract.currentFileHeading")}
              icon={nerdIcon.file}
              shortcut="f"
              hint={props.translate("tui.contract.filePickerHint")}
              {...(props.onFilePickerOpen === undefined ? {} : { onHintPress: props.onFilePickerOpen })}
              bottomBorder={showInfoBlockDividers()}
            >
              <PanelPathValue path={currentFile()} rows={currentFileRows()} />
            </PanelInfoBlock>
            <PanelInfoBlock
              title={props.translate("tui.contract.selectContract")}
              icon={nerdIcon.contract}
              shortcut="←/→"
              hint={props.translate("tui.contract.sourceContractPickerHint")}
              {...(props.onFilePickerOpen === undefined ? {} : { onHintPress: props.onFilePickerOpen })}
              bottomBorder={showInfoBlockDividers()}
            >
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
              <ContractMetricLine rows={metricRows()} />
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
            <PanelInfoBlock
              title={props.translate("tui.contract.deployedContract")}
              icon={nerdIcon.deployed}
              shortcut="c"
              hint={props.translate("tui.contract.deployedPickerHint")}
              {...(props.onDeployedPickerOpen === undefined ? {} : { onHintPress: props.onDeployedPickerOpen })}
            >
              <box height={1} width="100%" flexDirection="row">
                <text flexShrink={0} fg={theme.color.muted} content={`${props.translate("tui.contract.activeInstance")} `} />
                <text
                  flexGrow={1}
                  flexShrink={1}
                  fg={props.activeDeployedContract === null ? theme.color.muted : theme.color.read}
                  content={activeContractLabel()}
                  wrapMode="none"
                />
              </box>
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
              <text fg={theme.color.muted} content={props.translate("tui.function.empty")} wrapMode="word" />
            ) : (
              groupedFunctions(activeFunctions()).map((group) => (
                <>
                  <box height={1} flexDirection="row">
                    <text fg={functionKindColor(group.kind)} content={`${functionKindIcon(group.kind)} ${props.translate(group.titleKey)}`} />
                  </box>
                  {group.rows.map((row) => (
                    <FunctionActionRow
                      functionItem={row.function}
                      index={row.index}
                      selected={props.selectedFunctionIndex === row.index}
                      translate={props.translate}
                      contentWidth={props.contentWidth}
                      {...(props.onFunctionSelect === undefined ? {} : { onSelect: props.onFunctionSelect })}
                      {...(props.onFunctionOpen === undefined ? {} : { onOpen: props.onFunctionOpen })}
                      {...(props.onFunctionToolsOpen === undefined ? {} : { onToolsOpen: props.onFunctionToolsOpen })}
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

function ContractMetricLine(props: { readonly rows: readonly (readonly ContractMetric[])[] }) {
  return (
    <box height={props.rows.length} flexDirection="column">
      <For each={props.rows}>
        {(row) => (
          <box height={1} flexDirection="row">
            <For each={row}>
              {(metric, index) => (
                <>
                  {index() === 0 ? null : <text flexShrink={0} fg={theme.color.border} content=" | " />}
                  <text flexShrink={0} fg={contractMetricColor(metric.tone)} content={metric.content} />
                </>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  );
}

function FunctionActionRow(props: {
  readonly functionItem: FunctionItem;
  readonly index: number;
  readonly selected: boolean;
  readonly translate: Translate;
  readonly contentWidth: number;
  readonly onSelect?: (index: number) => void;
  readonly onOpen?: (index: number) => void;
  readonly onToolsOpen?: (index: number) => void;
}) {
  const lines = () => functionActionLines(props.functionItem, props.selected, props.contentWidth, props.translate);
  return (
    <box
      id={contractFunctionRowId(props.functionItem, props.index)}
      height={lines().length}
      paddingX={1}
      onMouseDown={(event: MouseEvent) => {
        if (event.button === 2) {
          props.onToolsOpen?.(props.index);
          return;
        }
        if (props.selected) {
          props.onOpen?.(props.index);
          return;
        }
        props.onSelect?.(props.index);
      }}
      flexDirection="column"
      {...selectedBoxBackground(props.selected)}
    >
      <For each={lines()}>
        {(line) => (
          <text
            height={1}
            fg={
              line.kind === "summary"
                ? props.selected ? theme.color.selected : functionKindColor(props.functionItem.kind)
                : line.kind === "value"
                  ? theme.color.payable
                  : theme.color.text
            }
            content={line.content}
            wrapMode="none"
          />
        )}
      </For>
    </box>
  );
}

function contractFunctionRowId(functionItem: FunctionItem, index: number): string {
  return `contract-function-${functionItem.name}-${index}`;
}

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

function contractMetricColor(tone: ContractMetric["tone"]) {
  return tone === "functions"
    ? theme.color.read
    : tone === "events"
      ? theme.color.payable
      : tone === "errors"
        ? theme.color.danger
        : theme.color.muted;
}

function functionKindIcon(kind: FunctionItem["kind"]): string {
  return kind === "read" ? nerdIcon.read : kind === "payable" ? nerdIcon.payable : nerdIcon.write;
}
