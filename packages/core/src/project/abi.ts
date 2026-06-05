export type ParamItem = {
  readonly name: string;
  readonly kind: string;
};

export type FunctionKind = "read" | "write" | "payable";

export type FunctionItem = {
  readonly name: string;
  readonly signature: string;
  readonly state_mutability: string;
  readonly kind: FunctionKind;
  readonly inputs: readonly ParamItem[];
  readonly outputs: readonly ParamItem[];
};

export type ConstructorItem = {
  readonly signature: string;
  readonly state_mutability: string;
  readonly inputs: readonly ParamItem[];
};

export type EventItem = {
  readonly name: string;
  readonly inputs: readonly ParamItem[];
  readonly anonymous: boolean;
};

export type NamedAbiItem = {
  readonly name: string;
  readonly inputs: readonly ParamItem[];
};

export function parseFunctionItem(item: unknown): FunctionItem {
  const name = getStringProperty(item, "name") ?? "";
  const stateMutability = getStringProperty(item, "stateMutability") ?? "nonpayable";
  return {
    name,
    signature: itemSignature(item),
    state_mutability: stateMutability,
    kind: functionKind(stateMutability),
    inputs: params(getProperty(item, "inputs")),
    outputs: params(getProperty(item, "outputs")),
  };
}

export function parseConstructorItem(item: unknown): ConstructorItem {
  const inputs = params(getProperty(item, "inputs"));
  return {
    signature: `constructor(${inputs.map((input) => input.kind).join(",")})`,
    state_mutability: getStringProperty(item, "stateMutability") ?? "nonpayable",
    inputs,
  };
}

export function parseEventItem(item: unknown): EventItem {
  return {
    name: getStringProperty(item, "name") ?? "",
    inputs: params(getProperty(item, "inputs")),
    anonymous: getBooleanProperty(item, "anonymous") ?? false,
  };
}

export function parseNamedAbiItem(item: unknown): NamedAbiItem {
  return {
    name: getStringProperty(item, "name") ?? "",
    inputs: params(getProperty(item, "inputs")),
  };
}

export function itemSignature(item: unknown): string {
  const name = getStringProperty(item, "name") ?? "";
  const inputs = itemParamTypes(item, "inputs").join(",");
  return `${name}(${inputs})`;
}

export function itemParamTypes(item: unknown, field: string): readonly string[] {
  return params(getProperty(item, field)).map((param) => param.kind);
}

export function paramType(param: unknown): string {
  const raw = getStringProperty(param, "type") ?? "unknown";
  const tupleSuffix = raw.startsWith("tuple") ? raw.slice("tuple".length) : null;
  if (tupleSuffix === null) {
    return raw;
  }

  const components = getArrayProperty(param, "components");
  if (components === undefined || components.length === 0) {
    return raw;
  }

  const inner = components.map(paramType).join(",");
  return `(${inner})${tupleSuffix}`;
}

function params(value: unknown): readonly ParamItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((param) => ({
    name: getStringProperty(param, "name") ?? "",
    kind: paramType(param),
  }));
}

function functionKind(stateMutability: string): FunctionKind {
  if (stateMutability === "view" || stateMutability === "pure") {
    return "read";
  }
  return stateMutability === "payable" ? "payable" : "write";
}

function getArrayProperty(raw: unknown, key: string): readonly unknown[] | undefined {
  const value = getProperty(raw, key);
  return Array.isArray(value) ? value : undefined;
}

function getStringProperty(raw: unknown, key: string): string | undefined {
  const value = getProperty(raw, key);
  return typeof value === "string" ? value : undefined;
}

function getBooleanProperty(raw: unknown, key: string): boolean | undefined {
  const value = getProperty(raw, key);
  return typeof value === "boolean" ? value : undefined;
}

function getProperty(raw: unknown, key: string): unknown {
  return isRecord(raw) ? raw[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
