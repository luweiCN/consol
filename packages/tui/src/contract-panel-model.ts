import type { DevSession, DevSourceTarget, FunctionItem } from "@consol/core";
import { targetTabLabel } from "./dev-selector-options";
import { displaySourceFile } from "./DevShellLabels";
import { nerdIcon } from "./icons";
import type { Translate } from "./panel-format";
import { terminalCellWidth, wrapTerminalText } from "./terminal-width";

export type ContractMetric = {
  readonly content: string;
  readonly tone: "functions" | "events" | "errors" | "muted";
};

export type FunctionActionLine = {
  readonly content: string;
  readonly kind: "summary" | "detail" | "value";
};

export type IndexedSourceTarget = DevSourceTarget & { readonly index: number };

export function contractHeaderHeight(
  rowCount: number,
  sourceFileRows: number,
  metricRows: number,
  nonDeployableRows: number,
  notDeployable: boolean,
  separatorRows: number,
): number {
  const tabHeight = Math.max(1, rowCount * 2 - 1);
  return sourceFileRows + 5 + metricRows + tabHeight + separatorRows + nonDeployableRows + (notDeployable ? 1 : 0);
}

export function contractMetricRows(
  summary: DevSession["abiSummary"] | undefined,
  contentWidth: number,
  translate: Translate,
): readonly (readonly ContractMetric[])[] {
  if (summary === undefined) {
    return [];
  }

  const metrics: readonly ContractMetric[] = [
    {
      content: `${nerdIcon.functions} ${summary.functions} ${translate("tui.contract.metric.functions")}`,
      tone: summary.functions === 0 ? "muted" : "functions",
    },
    {
      content: `${nerdIcon.events} ${summary.events} ${translate("tui.contract.metric.events")}`,
      tone: summary.events === 0 ? "muted" : "events",
    },
    {
      content: `${nerdIcon.warning} ${summary.errors} ${translate("tui.contract.metric.errors")}`,
      tone: summary.errors === 0 ? "muted" : "errors",
    },
  ];
  const rows: ContractMetric[][] = [];
  let row: ContractMetric[] = [];
  let rowWidth = 0;
  for (const metric of metrics) {
    const metricWidth = terminalCellWidth(metric.content);
    const separatorWidth = row.length === 0 ? 0 : 3;
    if (row.length > 0 && rowWidth + separatorWidth + metricWidth > Math.max(12, contentWidth)) {
      rows.push(row);
      row = [];
      rowWidth = 0;
    }
    row.push(metric);
    rowWidth += metricWidth + (row.length === 1 ? 0 : 3);
  }
  if (row.length > 0) {
    rows.push(row);
  }
  return rows;
}

export function contractTabRows(
  targets: readonly IndexedSourceTarget[],
  contentWidth: number,
  translate: Translate,
): readonly (readonly IndexedSourceTarget[])[] {
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

export function contractTargets(
  session: DevSession | undefined,
  selectedSourceFile: string | null,
): readonly IndexedSourceTarget[] {
  const sourceFile = selectedSourceFile ?? displaySourceFile(session);
  if (session === undefined || sourceFile === null) {
    return [];
  }

  return session.sourceTargets
    .map((target, index) => ({ ...target, index }))
    .filter((target) => target.sourceFile === sourceFile);
}

export function primaryContractTargets(targets: readonly IndexedSourceTarget[]): readonly IndexedSourceTarget[] {
  const deployable = targets.filter((target) => target.deployable !== false);
  return deployable.length === 0 ? targets : deployable;
}

export function functionActionLines(
  functionItem: FunctionItem,
  selected: boolean,
  contentWidth: number,
  translate: Translate,
): readonly FunctionActionLine[] {
  const lineWidth = Math.max(8, contentWidth - 2);
  const summary = `${selected ? ">" : " "} [${functionBadge(functionItem.kind, translate)}] ${functionItem.signature}`;
  const lines: FunctionActionLine[] = wrapFunctionSummary(summary, lineWidth).map((content) => ({ content, kind: "summary" }));
  if (!selected) {
    return lines;
  }

  const inputs = functionItem.inputs.map((input) => `${input.name || "_"}:${input.kind}`).join(", ") || translate("tui.function.noArgs");
  const outputs = functionItem.outputs.map((output) => output.kind).join(", ") || translate("tui.function.noReturns");
  const details: FunctionActionLine[] = [
    ...functionDetailLines(translate("tui.function.args"), functionItem.inputs.map((input) => `${input.name || "_"}:${input.kind}`), inputs, lineWidth),
    ...functionDetailLines(translate("tui.function.returns"), functionItem.outputs.map((output) => output.kind), outputs, lineWidth),
  ];
  if (functionItem.kind === "payable") {
    details.push(
      ...wrapTerminalText(
        `  ${translate("tui.function.value")}: ${translate("tui.function.payableValue")}`,
        lineWidth,
        "    ",
      ).map((content) => ({ content, kind: "value" as const })),
    );
  }
  return [...lines, ...details];
}

function functionBadge(kind: FunctionItem["kind"], translate: Translate): string {
  return kind === "read"
    ? translate("tui.function.badge.read")
    : kind === "payable"
      ? translate("tui.function.badge.payable")
      : translate("tui.function.badge.write");
}

function wrapFunctionSummary(summary: string, width: number): readonly string[] {
  const segments = summary.match(/[^,]*,|[^,]+$/g) ?? [summary];
  const lines: string[] = [];
  let current = "";
  for (const segment of segments) {
    const candidate = `${current}${segment}`;
    if (current.length === 0 || terminalCellWidth(candidate) <= width) {
      current = candidate;
      continue;
    }

    lines.push(current);
    current = `  ${segment}`;
    if (terminalCellWidth(current) > width) {
      const wrapped = wrapTerminalText(current, width, "  ");
      lines.push(...wrapped.slice(0, -1));
      current = wrapped.at(-1) ?? "";
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

function functionDetailLines(
  label: string,
  values: readonly string[],
  emptyValue: string,
  width: number,
): readonly FunctionActionLine[] {
  const inline = `  ${label}: ${emptyValue}`;
  if (values.length <= 1 || terminalCellWidth(inline) <= width) {
    return wrapTerminalText(inline, width, "    ").map((content) => ({ content, kind: "detail" }));
  }

  return [
    { content: `  ${label}:`, kind: "detail" },
    ...values.flatMap((value) =>
      wrapTerminalText(`    ${value}`, width, "    ").map((content) => ({ content, kind: "detail" as const })),
    ),
  ];
}
