import { ProjectError, stableHash } from "./artifacts";

export type StorageLayout = {
  readonly storage: readonly StorageVariable[];
  readonly types: Readonly<Record<string, StorageType>>;
};

export type StorageVariable = {
  readonly astId: number | null;
  readonly contract: string;
  readonly label: string;
  readonly offset: number;
  readonly slot: string;
  readonly typeId: string;
};

export type StorageType = {
  readonly id: string;
  readonly encoding: string;
  readonly label: string;
  readonly numberOfBytes: number;
  readonly base?: string;
  readonly key?: string;
  readonly value?: string;
  readonly members?: readonly StorageMember[];
};

export type StorageMember = {
  readonly astId: number | null;
  readonly contract: string;
  readonly label: string;
  readonly offset: number;
  readonly slot: string;
  readonly typeId: string;
};

export function parseStorageLayoutJson(source: string): StorageLayout {
  const raw = parseJson(source);
  const typesRecord = recordProperty(raw, "types") ?? {};
  const types = Object.fromEntries(
    Object.entries(typesRecord).map(([id, value]) => [id, normalizeType(id, value)]),
  );
  const storage = arrayProperty(raw, "storage").map(normalizeVariable);

  return { storage, types };
}

export function storageVariables(layout: StorageLayout): readonly StorageVariable[] {
  return layout.storage;
}

export function storageType(layout: StorageLayout, typeId: string): StorageType | undefined {
  return layout.types[typeId];
}

export function storageLayoutId(layout: StorageLayout): string {
  const normalized = {
    storage: layout.storage.map((item) => ({
      label: item.label,
      slot: item.slot,
      offset: item.offset,
      typeId: item.typeId,
    })),
    types: Object.fromEntries(
      Object.entries(layout.types).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };

  return `layout:${stableHash(JSON.stringify(normalized))}`;
}

function normalizeVariable(raw: unknown): StorageVariable {
  return {
    astId: numberProperty(raw, "astId") ?? null,
    contract: stringProperty(raw, "contract") ?? "",
    label: stringProperty(raw, "label") ?? "",
    offset: numberProperty(raw, "offset") ?? 0,
    slot: stringProperty(raw, "slot") ?? "0",
    typeId: stringProperty(raw, "type") ?? "",
  };
}

function normalizeType(id: string, raw: unknown): StorageType {
  const members = arrayProperty(raw, "members").map(normalizeMember);
  return {
    id,
    encoding: stringProperty(raw, "encoding") ?? "",
    label: stringProperty(raw, "label") ?? id,
    numberOfBytes: numberOfBytesProperty(raw) ?? 32,
    ...optionalString(raw, "base"),
    ...optionalString(raw, "key"),
    ...optionalString(raw, "value"),
    ...(members.length === 0 ? {} : { members }),
  };
}

function normalizeMember(raw: unknown): StorageMember {
  return {
    astId: numberProperty(raw, "astId") ?? null,
    contract: stringProperty(raw, "contract") ?? "",
    label: stringProperty(raw, "label") ?? "",
    offset: numberProperty(raw, "offset") ?? 0,
    slot: stringProperty(raw, "slot") ?? "0",
    typeId: stringProperty(raw, "type") ?? "",
  };
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new ProjectError({
      code: "storage_layout_parse_failed",
      message: `Failed to parse storage layout JSON: ${error instanceof Error ? error.message : String(error)}`,
      hint: source,
    });
  }
}

function arrayProperty(raw: unknown, key: string): readonly unknown[] {
  const value = property(raw, key);
  return Array.isArray(value) ? value : [];
}

function recordProperty(raw: unknown, key: string): Record<string, unknown> | undefined {
  const value = property(raw, key);
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringProperty(raw: unknown, key: string): string | undefined {
  const value = property(raw, key);
  return typeof value === "string" ? value : undefined;
}

function numberProperty(raw: unknown, key: string): number | undefined {
  const value = property(raw, key);
  return typeof value === "number" ? value : undefined;
}

function numberOfBytesProperty(raw: unknown): number | undefined {
  const value = property(raw, "numberOfBytes");
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalString(raw: unknown, key: "base" | "key" | "value"): Partial<Pick<StorageType, "base" | "key" | "value">> {
  const value = stringProperty(raw, key);
  return value === undefined ? {} : { [key]: value };
}

function property(raw: unknown, key: string): unknown {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>)[key] : undefined;
}
