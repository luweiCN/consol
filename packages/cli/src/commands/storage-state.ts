import {
  arrayElementSlot,
  decodeStorageWord,
  parseStorageLayoutJson,
  planStorageSummaryReads,
  storageLayoutId,
  type StateKeyBook,
  type StateKeyBookContract,
  type StateKeySelection,
  type StateTupleKeySelection,
  type StorageLayout,
  type StorageMember,
  type StorageReadPlan,
  type StorageType,
  type StorageVariable,
} from "@consol/core";
import type { RpcAdapter } from "@consol/rpc";

export type ComplexStorageSnapshotMode = "summary" | "detail";

export type ComplexStorageSnapshot = {
  readonly layout_id: string;
  readonly rows: readonly ComplexStorageRow[];
  readonly hints: readonly string[];
};

export type ComplexStorageRow = {
  readonly id: string;
  readonly kind: "scalar" | "array" | "struct" | "mapping" | "error";
  readonly name: string;
  readonly type_label: string;
  readonly summary: string;
  readonly detail_available: boolean;
  readonly checked?: number;
  readonly non_default?: number;
  readonly default_values_hidden?: boolean;
  readonly entries?: readonly ComplexStorageEntry[];
  readonly error?: string | null;
};

export type ComplexStorageEntry = {
  readonly label: string | null;
  readonly key: readonly string[];
  readonly readable: string;
  readonly raw: string;
  readonly default: boolean;
};

export async function createComplexStorageSnapshot(input: {
  readonly layoutJson: string;
  readonly projectRoot: string;
  readonly target: string;
  readonly contract: string;
  readonly address: string;
  readonly rpc: RpcAdapter;
  readonly keyBook: StateKeyBook;
  readonly previewLimit: number;
  readonly mode: ComplexStorageSnapshotMode;
  readonly rowId?: string;
  readonly showDefaults?: boolean;
}): Promise<ComplexStorageSnapshot> {
  void input.projectRoot;
  void input.target;
  void input.contract;
  void input.mode;
  void input.rowId;
  void input.showDefaults;

  const layout = parseStorageLayoutJson(input.layoutJson);
  const layoutId = storageLayoutId(layout);
  const keySelection = keySelectionForContract(input.keyBook.contracts[layoutId]);
  const rows = await mapLimit(layout.storage, 8, async (variable) =>
    await storageRow({
      layout,
      variable,
      address: input.address,
      rpc: input.rpc,
      keySelection,
      previewLimit: input.previewLimit,
    })
  );
  const hasMappingDefaultsHidden = rows.some((row) => row.kind === "mapping" && row.default_values_hidden === true);

  return {
    layout_id: layoutId,
    rows,
    hints: hasMappingDefaultsHidden ? ["mapping default values hidden; Enter shows checked keys"] : [],
  };
}

async function storageRow(input: {
  readonly layout: StorageLayout;
  readonly variable: StorageVariable;
  readonly address: string;
  readonly rpc: RpcAdapter;
  readonly keySelection: KeySelection;
  readonly previewLimit: number;
}): Promise<ComplexStorageRow> {
  const type = input.layout.types[input.variable.typeId];
  if (type === undefined) {
    return errorRow(input.variable.label, input.variable.typeId, "Storage type metadata is missing.");
  }

  try {
    if (type.encoding === "mapping") {
      return await mappingRow(input, type);
    }
    if (type.encoding === "dynamic_array") {
      return await dynamicArrayRow(input, type);
    }
    if (type.members !== undefined && type.members.length > 0) {
      return await structRow(input, type);
    }
    if (type.encoding === "inplace") {
      return await scalarRow(input, type);
    }
    return {
      id: `storage:${input.variable.label}`,
      kind: "error",
      name: input.variable.label,
      type_label: type.label,
      summary: `unsupported storage encoding: ${type.encoding}`,
      detail_available: false,
      error: `unsupported storage encoding: ${type.encoding}`,
    };
  } catch (error) {
    return errorRow(input.variable.label, type.label, error instanceof Error ? error.message : String(error));
  }
}

async function scalarRow(input: {
  readonly variable: StorageVariable;
  readonly address: string;
  readonly rpc: RpcAdapter;
}, type: StorageType): Promise<ComplexStorageRow> {
  const word = await input.rpc.getStorageAt({ address: input.address, slot: slotHex(input.variable.slot) });
  const decoded = decodeStorageWord({
    typeLabel: type.label,
    numberOfBytes: type.numberOfBytes,
    word,
    offsetBytes: input.variable.offset,
  });

  return {
    id: `storage:${input.variable.label}`,
    kind: "scalar",
    name: input.variable.label,
    type_label: type.label,
    summary: decoded.readable,
    detail_available: false,
    entries: [{
      label: null,
      key: [],
      readable: decoded.readable,
      raw: decoded.raw,
      default: decoded.default,
    }],
  };
}

async function dynamicArrayRow(input: {
  readonly layout: StorageLayout;
  readonly variable: StorageVariable;
  readonly address: string;
  readonly rpc: RpcAdapter;
  readonly previewLimit: number;
}, type: StorageType): Promise<ComplexStorageRow> {
  const baseType = type.base === undefined ? undefined : input.layout.types[type.base];
  if (baseType === undefined) {
    return errorRow(input.variable.label, type.label, "Dynamic array base type metadata is missing.");
  }

  const lengthWord = await input.rpc.getStorageAt({ address: input.address, slot: slotHex(input.variable.slot) });
  const length = Number(BigInt(lengthWord));
  const cappedLength = Number.isSafeInteger(length) ? Math.min(length, input.previewLimit) : input.previewLimit;
  const values = await mapLimit([...Array(cappedLength).keys()], 8, async (index) => {
    const word = await input.rpc.getStorageAt({ address: input.address, slot: arrayElementSlot(input.variable.slot, index) });
    const decoded = decodeStorageWord({
      typeLabel: baseType.label,
      numberOfBytes: baseType.numberOfBytes,
      word,
    });
    return decoded.readable;
  });
  const suffix = length > values.length ? ", ..." : "";

  return {
    id: `storage:${input.variable.label}`,
    kind: "array",
    name: input.variable.label,
    type_label: type.label,
    summary: `len=${length} [${values.join(", ")}${suffix}]`,
    detail_available: length > values.length,
  };
}

async function structRow(input: {
  readonly layout: StorageLayout;
  readonly variable: StorageVariable;
  readonly address: string;
  readonly rpc: RpcAdapter;
  readonly previewLimit: number;
}, type: StorageType): Promise<ComplexStorageRow> {
  const members = (type.members ?? []).slice(0, input.previewLimit);
  const values = await mapLimit(members, 8, async (member) => await structMemberSummary(input, member));
  const suffix = (type.members?.length ?? 0) > values.length ? ", ..." : "";

  return {
    id: `storage:${input.variable.label}`,
    kind: "struct",
    name: input.variable.label,
    type_label: type.label,
    summary: `{${values.join(", ")}${suffix}}`,
    detail_available: (type.members?.length ?? 0) > values.length,
  };
}

async function structMemberSummary(input: {
  readonly layout: StorageLayout;
  readonly variable: StorageVariable;
  readonly address: string;
  readonly rpc: RpcAdapter;
}, member: StorageMember): Promise<string> {
  const type = input.layout.types[member.typeId];
  if (type === undefined) {
    return `${member.label}: ?`;
  }
  const word = await input.rpc.getStorageAt({
    address: input.address,
    slot: slotHex((slotBigInt(input.variable.slot) + slotBigInt(member.slot)).toString(10)),
  });
  const decoded = decodeStorageWord({
    typeLabel: type.label,
    numberOfBytes: type.numberOfBytes,
    word,
    offsetBytes: member.offset,
  });
  return `${member.label}: ${decoded.readable}`;
}

async function mappingRow(input: {
  readonly layout: StorageLayout;
  readonly variable: StorageVariable;
  readonly address: string;
  readonly rpc: RpcAdapter;
  readonly keySelection: KeySelection;
  readonly previewLimit: number;
}, type: StorageType): Promise<ComplexStorageRow> {
  const plans = planStorageSummaryReads({
    layout: input.layout,
    keyBook: input.keySelection,
    previewLimit: input.previewLimit,
  }).filter((plan) => plan.variable === input.variable.label);
  const entries = await mapLimit(plans, 8, async (plan) => await readEntry(input, plan));
  const visible = entries.filter((entry) => !entry.default);

  return {
    id: `storage:${input.variable.label}`,
    kind: "mapping",
    name: input.variable.label,
    type_label: type.label,
    summary: mappingSummary(visible, entries.length),
    detail_available: true,
    checked: entries.length,
    non_default: visible.length,
    default_values_hidden: entries.length > visible.length,
    entries: visible,
  };
}

async function readEntry(input: {
  readonly address: string;
  readonly rpc: RpcAdapter;
}, plan: StorageReadPlan): Promise<ComplexStorageEntry> {
  const word = await input.rpc.getStorageAt({ address: input.address, slot: plan.slot });
  const decoded = decodeStorageWord({
    typeLabel: plan.typeLabel,
    numberOfBytes: plan.numberOfBytes,
    word,
    offsetBytes: plan.offsetBytes,
  });

  return {
    label: plan.keyLabel ?? null,
    key: plan.keyValues ?? [],
    readable: decoded.readable,
    raw: decoded.raw,
    default: decoded.default,
  };
}

function mappingSummary(entries: readonly ComplexStorageEntry[], checked: number): string {
  if (checked === 0) {
    return "no compatible keys";
  }
  if (entries.length === 0) {
    return `${checked} checked, all default`;
  }
  return `${entries.map((entry) => `${entryLabel(entry)}=${entry.readable}`).join(", ")} (${checked} checked)`;
}

function entryLabel(entry: ComplexStorageEntry): string {
  return entry.label ?? (entry.key.length === 0 ? "key" : entry.key.join(","));
}

function keySelectionForContract(contract: StateKeyBookContract | undefined): KeySelection {
  return {
    address: keysOfType(contract, "address"),
    uint256: keysOfType(contract, "uint256"),
    bytes32: keysOfType(contract, "bytes32"),
    bool: keysOfType(contract, "bool"),
    tuple: (contract?.tupleKeys ?? []).map((key) => ({
      types: key.types,
      values: key.values,
      label: key.label,
      enabled: key.enabled,
    })),
  };
}

type KeySelection = {
  readonly address: readonly StateKeySelection[];
  readonly uint256: readonly StateKeySelection[];
  readonly bytes32: readonly StateKeySelection[];
  readonly bool: readonly StateKeySelection[];
  readonly tuple: readonly StateTupleKeySelection[];
};

function keysOfType(contract: StateKeyBookContract | undefined, type: string): readonly StateKeySelection[] {
  return (contract?.keys ?? [])
    .filter((key) => key.type === type)
    .map((key) => ({
      type: key.type,
      value: key.value,
      label: key.label,
      enabled: key.enabled,
    }));
}

function errorRow(name: string, typeLabel: string, message: string): ComplexStorageRow {
  return {
    id: `storage:${name}:error`,
    kind: "error",
    name,
    type_label: typeLabel,
    summary: message,
    detail_available: false,
    error: message,
  };
}

async function mapLimit<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value !== undefined) {
        results[index] = await mapper(value, index);
      }
    }
  };
  await Promise.all([...Array(Math.min(concurrency, values.length)).keys()].map(worker));
  return results;
}

function slotHex(slot: string): `0x${string}` {
  return `0x${slotBigInt(slot).toString(16).padStart(64, "0")}`;
}

function slotBigInt(slot: string): bigint {
  return slot.startsWith("0x") ? BigInt(slot) : BigInt(slot);
}
