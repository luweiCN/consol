import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writePrivateFile } from "../config/private-write";
import { ProjectError } from "./artifacts";

export type StateKeyBook = {
  readonly version: 1;
  readonly contracts: Readonly<Record<string, StateKeyBookContract>>;
};

export type StateKeyBookContract = {
  readonly target: string;
  readonly contract: string;
  readonly keys: readonly StateKeyBookEntry[];
  readonly tupleKeys: readonly StateTupleKeyBookEntry[];
};

export type StateKeyBookEntry = {
  readonly type: string;
  readonly value: string;
  readonly label: string | null;
  readonly enabled: boolean;
};

export type StateTupleKeyBookEntry = {
  readonly types: readonly string[];
  readonly values: readonly string[];
  readonly label: string | null;
  readonly enabled: boolean;
};

export function stateKeyBookPath(projectRoot: string): string {
  return join(projectRoot, ".consol", "state-keys.json");
}

export function readStateKeyBook(projectRoot: string): StateKeyBook {
  const path = stateKeyBookPath(projectRoot);
  if (!existsSync(path)) {
    return emptyStateKeyBook();
  }

  return normalizeStateKeyBook(parseStateKeyBook(path));
}

export function writeStateKeyBook(projectRoot: string, book: StateKeyBook): void {
  writePrivateFile(stateKeyBookPath(projectRoot), `${JSON.stringify(book, null, 2)}\n`);
}

export function addStateKey(
  book: StateKeyBook,
  input: {
    readonly layoutId: string;
    readonly target: string;
    readonly contract: string;
    readonly key: StateKeyBookEntry;
  },
): StateKeyBook {
  const contract = stateKeyBookContract(book, input.layoutId, input.target, input.contract);
  const keys = [
    ...contract.keys.filter((key) => key.type !== input.key.type || key.value !== input.key.value),
    input.key,
  ];

  return withContract(book, input.layoutId, { ...contract, keys });
}

export function deleteStateKey(
  book: StateKeyBook,
  input: {
    readonly layoutId: string;
    readonly type: string;
    readonly value: string;
  },
): StateKeyBook {
  const contract = book.contracts[input.layoutId];
  if (contract === undefined) {
    return book;
  }

  return withContract(book, input.layoutId, {
    ...contract,
    keys: contract.keys.filter((key) => key.type !== input.type || key.value !== input.value),
  });
}

export function addStateTupleKey(
  book: StateKeyBook,
  input: {
    readonly layoutId: string;
    readonly target: string;
    readonly contract: string;
    readonly key: StateTupleKeyBookEntry;
  },
): StateKeyBook {
  const contract = stateKeyBookContract(book, input.layoutId, input.target, input.contract);
  const keys = [
    ...contract.tupleKeys.filter((key) => tupleKeyId(key) !== tupleKeyId(input.key)),
    input.key,
  ];

  return withContract(book, input.layoutId, { ...contract, tupleKeys: keys });
}

export function deleteStateTupleKey(
  book: StateKeyBook,
  input: {
    readonly layoutId: string;
    readonly types: readonly string[];
    readonly values: readonly string[];
  },
): StateKeyBook {
  const contract = book.contracts[input.layoutId];
  if (contract === undefined) {
    return book;
  }
  const targetId = tupleKeyId({ types: input.types, values: input.values });

  return withContract(book, input.layoutId, {
    ...contract,
    tupleKeys: contract.tupleKeys.filter((key) => tupleKeyId(key) !== targetId),
  });
}

function emptyStateKeyBook(): StateKeyBook {
  return { version: 1, contracts: {} };
}

function stateKeyBookContract(
  book: StateKeyBook,
  layoutId: string,
  target: string,
  contract: string,
): StateKeyBookContract {
  return book.contracts[layoutId] ?? { target, contract, keys: [], tupleKeys: [] };
}

function withContract(book: StateKeyBook, layoutId: string, contract: StateKeyBookContract): StateKeyBook {
  return {
    version: 1,
    contracts: {
      ...book.contracts,
      [layoutId]: contract,
    },
  };
}

function parseStateKeyBook(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new ProjectError({
      code: "state_key_book_invalid",
      message: `State Key Book is not valid JSON: ${path}`,
      hint: error instanceof Error ? error.message : "Fix or remove the state key book file.",
    });
  }
}

function normalizeStateKeyBook(raw: unknown): StateKeyBook {
  const contracts = recordProperty(raw, "contracts") ?? {};
  return {
    version: 1,
    contracts: Object.fromEntries(
      Object.entries(contracts).map(([layoutId, value]) => [layoutId, normalizeContract(value)]),
    ),
  };
}

function normalizeContract(raw: unknown): StateKeyBookContract {
  return {
    target: stringProperty(raw, "target") ?? "",
    contract: stringProperty(raw, "contract") ?? "",
    keys: arrayProperty(raw, "keys").map(normalizeKey),
    tupleKeys: tupleKeyArray(raw).map(normalizeTupleKey),
  };
}

function normalizeKey(raw: unknown): StateKeyBookEntry {
  return {
    type: stringProperty(raw, "type") ?? "",
    value: stringProperty(raw, "value") ?? "",
    label: stringProperty(raw, "label") ?? null,
    enabled: booleanProperty(raw, "enabled") ?? true,
  };
}

function normalizeTupleKey(raw: unknown): StateTupleKeyBookEntry {
  return {
    types: arrayProperty(raw, "types").flatMap(stringValue),
    values: arrayProperty(raw, "values").flatMap(stringValue),
    label: stringProperty(raw, "label") ?? null,
    enabled: booleanProperty(raw, "enabled") ?? true,
  };
}

function tupleKeyArray(raw: unknown): readonly unknown[] {
  const camelCase = arrayProperty(raw, "tupleKeys");
  return camelCase.length > 0 ? camelCase : arrayProperty(raw, "tuple_keys");
}

function tupleKeyId(key: Pick<StateTupleKeyBookEntry, "types" | "values">): string {
  return `${key.types.join(",")}:${key.values.join("\u001f")}`;
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
  return stringValue(property(raw, key))[0];
}

function booleanProperty(raw: unknown, key: string): boolean | undefined {
  const value = property(raw, key);
  return typeof value === "boolean" ? value : undefined;
}

function stringValue(value: unknown): readonly string[] {
  return typeof value === "string" ? [value] : [];
}

function property(raw: unknown, key: string): unknown {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>)[key] : undefined;
}
