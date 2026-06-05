import type { FunctionItem } from "@consol/core";
import type { MessageKey } from "@consol/i18n";

export type DevFunctionRow = {
  readonly function: FunctionItem;
  readonly index: number;
};

export type DevFunctionGroup = {
  readonly titleKey: MessageKey;
  readonly kind: FunctionItem["kind"];
  readonly rows: readonly DevFunctionRow[];
};

const functionKinds = ["read", "write", "payable"] as const satisfies readonly FunctionItem["kind"][];

export function groupedFunctions(functions: readonly FunctionItem[]): readonly DevFunctionGroup[] {
  const rows = functions.map((item, index) => ({ function: item, index }));
  return functionKinds
    .map((kind) => ({
      kind,
      titleKey: functionGroupTitleKey(kind),
      rows: rows.filter((row) => row.function.kind === kind),
    }))
    .filter((group) => group.rows.length > 0);
}

export function functionNeedsInput(functionItem: FunctionItem): boolean {
  return functionItem.inputs.length > 0 || functionItem.kind === "payable";
}

export function visibleContractActionFunctions(
  functions: readonly FunctionItem[],
  options: { readonly hideNoArgReadActions: boolean },
): readonly FunctionItem[] {
  if (!options.hideNoArgReadActions) {
    return functions;
  }

  return functions.filter((item) => item.kind !== "read" || item.inputs.length > 0);
}

function functionGroupTitleKey(kind: FunctionItem["kind"]): MessageKey {
  return kind === "read" ? "tui.function.group.read" : kind === "write" ? "tui.function.group.write" : "tui.function.group.payable";
}
