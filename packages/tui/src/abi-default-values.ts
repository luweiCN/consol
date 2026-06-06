import type { DevFunctionInputDraft } from "@consol/core";

const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

export function argsFromDraftWithAbiDefaults(draft: DevFunctionInputDraft): readonly string[] {
  return draft.argumentTexts.map((value, index) => {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }

    return abiDefaultValue(draft.function.inputs[index]?.kind) ?? trimmed;
  });
}

export function abiDefaultValue(kind: string | undefined): string | null {
  const type = kind?.trim() ?? "";
  const compact = type.replace(/\s+/g, "");
  if (/^address(?:payable)?$/.test(compact)) {
    return ADDRESS_ZERO;
  }
  if (isIntegerType(compact)) {
    return "0";
  }
  if (compact === "bool") {
    return "false";
  }
  if (compact === "string") {
    return "";
  }
  if (compact === "bytes") {
    return "0x";
  }

  const bytesMatch = compact.match(/^bytes([1-9]|[12]\d|3[0-2])$/);
  if (bytesMatch?.[1] !== undefined) {
    return `0x${"00".repeat(Number(bytesMatch[1]))}`;
  }

  return null;
}

function isIntegerType(type: string): boolean {
  const match = type.match(/^(u?int)(\d{0,3})$/);
  if (match === null) {
    return false;
  }

  const bits = match[2];
  if (bits === undefined || bits === "") {
    return true;
  }

  const width = Number(bits);
  return Number.isInteger(width) && width >= 8 && width <= 256 && width % 8 === 0;
}
