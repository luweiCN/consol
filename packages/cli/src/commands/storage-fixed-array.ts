import { decodeStorageWord, type StorageLayout, type StorageType, type StorageVariable } from "@consol/core";
import type { RpcAdapter } from "@consol/rpc";
import type { ComplexStorageRow } from "./storage-state";

const detailEntryLimit = 100;

export function isFixedArrayStorageType(type: StorageType): boolean {
  return type.encoding === "inplace" && type.base !== undefined && fixedArrayLength(type.label) !== null;
}

export async function fixedArrayRow(input: {
  readonly layout: StorageLayout;
  readonly variable: StorageVariable;
  readonly address: string;
  readonly rpc: RpcAdapter;
  readonly previewLimit: number;
  readonly detail: boolean;
}, type: StorageType): Promise<ComplexStorageRow> {
  const baseType = type.base === undefined ? undefined : input.layout.types[type.base];
  const length = fixedArrayLength(type.label);
  if (baseType === undefined) {
    return errorRow(input.variable.label, type.label, "Fixed array base type metadata is missing.");
  }
  if (length === null) {
    return errorRow(input.variable.label, type.label, "Fixed array length is missing.");
  }
  if (baseType.encoding !== "inplace" || baseType.members !== undefined || baseType.base !== undefined) {
    return errorRow(input.variable.label, type.label, `unsupported fixed array base type: ${baseType.label}`);
  }

  const limit = input.detail ? detailEntryLimit : input.previewLimit;
  const cappedLength = Math.min(length, limit);
  const entries = await Promise.all([...Array(cappedLength).keys()].map(async (index) => {
    const location = fixedArrayElementLocation(input.variable.slot, index, baseType.numberOfBytes);
    const word = await input.rpc.getStorageAt({ address: input.address, slot: location.slot });
    const decoded = decodeStorageWord({
      typeLabel: baseType.label,
      numberOfBytes: baseType.numberOfBytes,
      word,
      offsetBytes: location.offsetBytes,
    });
    return {
      label: String(index),
      key: [String(index)],
      readable: decoded.readable,
      raw: decoded.raw,
      default: decoded.default,
    };
  }));
  const values = entries.map((entry) => entry.readable);
  const suffix = length > values.length ? ", ..." : "";

  return {
    id: storageRowId(input.variable.label),
    kind: "array",
    name: input.variable.label,
    type_label: type.label,
    summary: `len=${length} [${values.join(", ")}${suffix}]`,
    detail_available: length > values.length,
    entries,
  };
}

function fixedArrayLength(label: string): number | null {
  const match = label.match(/\[(\d+)\]$/);
  if (match?.[1] === undefined) {
    return null;
  }
  const length = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

function fixedArrayElementLocation(baseSlot: string, index: number, numberOfBytes: number): {
  readonly slot: `0x${string}`;
  readonly offsetBytes: number;
} {
  const elementBytes = Math.max(1, Math.min(numberOfBytes, 32));
  const elementsPerSlot = Math.max(1, Math.floor(32 / elementBytes));
  const slotOffset = BigInt(Math.floor(index / elementsPerSlot));
  return {
    slot: slotHex((slotBigInt(baseSlot) + slotOffset).toString(10)),
    offsetBytes: (index % elementsPerSlot) * elementBytes,
  };
}

function errorRow(name: string, typeLabel: string, message: string): ComplexStorageRow {
  return {
    id: `${storageRowId(name)}:error`,
    kind: "error",
    name,
    type_label: typeLabel,
    summary: message,
    detail_available: false,
    error: message,
  };
}

function storageRowId(name: string): string {
  return `storage:${name}`;
}

function slotHex(slot: string): `0x${string}` {
  return `0x${slotBigInt(slot).toString(16).padStart(64, "0")}`;
}

function slotBigInt(slot: string): bigint {
  return slot.startsWith("0x") ? BigInt(slot) : BigInt(slot);
}
