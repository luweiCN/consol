import type { DevFunctionInputDraft } from "@consol/core";
import type { DevChainStateOption, DevStateValueSnapshot } from "./runtime-types";
import type { SelectorOption } from "./SelectorModal";

export function stateValueRowId(value: DevStateValueSnapshot): string {
  return `abi:${value.signature}`;
}

export function mappingKeyTypeFromTypeLabel(typeLabel: string): string | null {
  const match = typeLabel.match(/^mapping\s*\((.+?)\s*=>/);
  const keyType = match?.[1]?.trim();
  return keyType === undefined || keyType.length === 0 ? null : keyType;
}

export function currentUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function isExitConfirmKey(key: { readonly ctrl?: boolean; readonly meta?: boolean; readonly name?: string; readonly sequence?: string }): boolean {
  return isPlainKey(key, "q");
}

export function isPlainKey(key: { readonly ctrl?: boolean; readonly meta?: boolean; readonly name?: string; readonly sequence?: string }, value: string): boolean {
  if (key.ctrl === true || key.meta === true) {
    return false;
  }
  return key.name?.toLowerCase() === value || key.sequence?.toLowerCase() === value;
}

export function isExactSequenceKey(key: { readonly name?: string; readonly sequence?: string }, value: string): boolean {
  return key.sequence === value || (key.sequence === undefined && key.name === value);
}

export function nextFunctionInputField(draft: DevFunctionInputDraft): DevFunctionInputDraft["activeField"] {
  const fields = functionInputFields(draft);
  const currentIndex = fields.findIndex((field) => sameFunctionInputField(field, draft.activeField));
  return fields[(currentIndex + 1) % fields.length] ?? { kind: "value" };
}

function functionInputFields(draft: DevFunctionInputDraft): readonly DevFunctionInputDraft["activeField"][] {
  return [
    ...draft.function.inputs.map((_, index) => ({ kind: "argument", index }) as const),
    ...(draft.function.kind === "payable" ? [{ kind: "value" } as const] : []),
  ];
}

function sameFunctionInputField(left: DevFunctionInputDraft["activeField"], right: DevFunctionInputDraft["activeField"]): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "value") {
    return true;
  }

  if (left.kind === "gasLimit") {
    return true;
  }

  return right.kind === "argument" && left.index === right.index;
}

export function chainStateOption(state: DevChainStateOption): SelectorOption {
  const created = state.createdAtUnix === undefined
    ? undefined
    : new Date(state.createdAtUnix * 1000).toLocaleString();
  return {
    name: state.name,
    label: state.label,
    active: false,
    ...(created === undefined ? {} : { meta: created }),
    ...(state.description === undefined ? {} : { description: state.description }),
    searchText: `${state.name} ${state.label} ${state.description ?? ""}`,
  };
}
