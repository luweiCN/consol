import { encodeAbiParameters, keccak256, padHex, toHex, type Hex } from "viem";
import type { StorageLayout, StorageType, StorageVariable } from "./storage-layout";

export type StateKeyBookSelection = {
  readonly address: readonly StateKeySelection[];
  readonly uint256?: readonly StateKeySelection[];
  readonly bytes32?: readonly StateKeySelection[];
  readonly bool?: readonly StateKeySelection[];
  readonly tuple: readonly StateTupleKeySelection[];
};

export type StateKeySelection = {
  readonly type: string;
  readonly value: string;
  readonly label: string | null;
  readonly enabled: boolean;
};

export type StateTupleKeySelection = {
  readonly types: readonly string[];
  readonly values: readonly string[];
  readonly label: string | null;
  readonly enabled: boolean;
};

export type StorageReadPlan = {
  readonly id: string;
  readonly variable: string;
  readonly slot: Hex;
  readonly typeId: string;
  readonly typeLabel: string;
  readonly offsetBytes: number;
  readonly numberOfBytes: number;
  readonly path: readonly string[];
  readonly keyType?: string;
  readonly keyLabel?: string | null;
  readonly keyValues?: readonly string[];
};

export function planStorageSummaryReads(input: {
  readonly layout: StorageLayout;
  readonly keyBook: StateKeyBookSelection;
  readonly previewLimit: number;
}): readonly StorageReadPlan[] {
  return input.layout.storage.flatMap((variable) => {
    const type = input.layout.types[variable.typeId];
    if (type === undefined) {
      return [];
    }

    if (type.encoding === "mapping") {
      return mappingReadPlans({
        layout: input.layout,
        variable,
        type,
        keyBook: input.keyBook,
        limit: input.previewLimit,
      });
    }

    if (type.encoding === "inplace") {
      return [storageReadPlan(input.layout, variable, type, slotHex(variable.slot), [variable.label])];
    }

    return [];
  });
}

export function arrayElementSlot(baseSlot: string, index: number): Hex {
  return addToSlot(keccak256(slotHex(baseSlot)), BigInt(index));
}

export function mappingValueSlot(input: {
  readonly baseSlot: string;
  readonly keyType: string;
  readonly keyValue: string;
}): Hex {
  const keyType = abiKeyType(input.keyType);
  const keyValue = abiKeyValue(keyType, input.keyValue);
  return keccak256(
    encodeAbiParameters(
      [{ type: keyType }, { type: "uint256" }],
      [keyValue, slotBigInt(input.baseSlot)],
    ),
  );
}

function mappingReadPlans(input: {
  readonly layout: StorageLayout;
  readonly variable: StorageVariable;
  readonly type: StorageType;
  readonly keyBook: StateKeyBookSelection;
  readonly limit: number;
}): readonly StorageReadPlan[] {
  if (input.type.key === undefined || input.type.value === undefined) {
    return [];
  }

  const keyType = input.layout.types[input.type.key];
  const valueType = input.layout.types[input.type.value];
  if (keyType === undefined || valueType === undefined) {
    return [];
  }

  return compatibleKeys(input.keyBook, keyType.label)
    .slice(0, input.limit)
    .map((key) => storageReadPlan(
      input.layout,
      input.variable,
      valueType,
      mappingValueSlot({
        baseSlot: input.variable.slot,
        keyType: keyType.label,
        keyValue: key.value,
      }),
      [`${input.variable.label}[${key.label ?? key.value}]`],
      key,
    ));
}

function storageReadPlan(
  layout: StorageLayout,
  variable: StorageVariable,
  type: StorageType,
  slot: Hex,
  path: readonly string[],
  key?: StateKeySelection,
): StorageReadPlan {
  return {
    id: key === undefined ? `storage:${variable.label}` : `storage:${variable.label}:${key.type}:${key.value}`,
    variable: variable.label,
    slot,
    typeId: type.id,
    typeLabel: type.label,
    offsetBytes: variable.offset,
    numberOfBytes: type.numberOfBytes,
    path,
    ...(key === undefined ? {} : { keyType: key.type, keyLabel: key.label, keyValues: [key.value] }),
  };
}

function compatibleKeys(keyBook: StateKeyBookSelection, typeLabel: string): readonly StateKeySelection[] {
  const keyType = abiKeyType(typeLabel);
  if (keyType === "address") {
    return keyBook.address.filter((key) => key.enabled);
  }
  if (keyType === "uint256") {
    return (keyBook.uint256 ?? []).filter((key) => key.enabled);
  }
  if (keyType === "bytes32") {
    return (keyBook.bytes32 ?? []).filter((key) => key.enabled);
  }
  if (keyType === "bool") {
    return (keyBook.bool ?? []).filter((key) => key.enabled);
  }
  return [];
}

function abiKeyType(type: string): "address" | "uint256" | "bytes32" | "bool" {
  if (type === "address" || type === "t_address") {
    return "address";
  }
  if (type === "bytes32" || type === "t_bytes32") {
    return "bytes32";
  }
  if (type === "bool" || type === "t_bool") {
    return "bool";
  }
  return "uint256";
}

function abiKeyValue(type: "address" | "uint256" | "bytes32" | "bool", value: string): Hex | bigint | boolean {
  if (type === "uint256") {
    return BigInt(value);
  }
  if (type === "bool") {
    return value === "true" || value === "1";
  }
  return value as Hex;
}

function addToSlot(slot: Hex, offset: bigint): Hex {
  return slotHex((BigInt(slot) + offset).toString(10));
}

function slotHex(slot: string): Hex {
  return padHex(toHex(slotBigInt(slot)), { size: 32 });
}

function slotBigInt(slot: string): bigint {
  return slot.startsWith("0x") ? BigInt(slot) : BigInt(slot);
}
