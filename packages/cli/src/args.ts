import { createUserError, type ConsolError } from "@consol/protocol";

export type GlobalArgs = {
  readonly json: boolean;
  readonly ndjson: boolean;
  readonly profile?: string;
  readonly network?: string;
  readonly rpcUrl?: string;
  readonly chainId?: number;
  readonly account?: string;
  readonly signer?: string;
  readonly project?: string;
  readonly yes: boolean;
  readonly confirmNetwork?: string;
  readonly noColor: boolean;
  readonly verbose: number;
};

type MutableGlobalArgs = {
  json: boolean;
  ndjson: boolean;
  profile?: string;
  network?: string;
  rpcUrl?: string;
  chainId?: number;
  account?: string;
  signer?: string;
  project?: string;
  yes: boolean;
  confirmNetwork?: string;
  noColor: boolean;
  verbose: number;
};

export type ParsedCliArgs = {
  readonly globals: GlobalArgs;
  readonly command?: string;
  readonly commandArgs: readonly string[];
};

export type ParseCliArgsResult =
  | { readonly ok: true; readonly value: ParsedCliArgs }
  | { readonly ok: false; readonly error: ConsolError };

const stringFlags = new Map<string, keyof GlobalArgs>([
  ["--profile", "profile"],
  ["--network", "network"],
  ["--rpc-url", "rpcUrl"],
  ["--account", "account"],
  ["--signer", "signer"],
  ["--project", "project"],
  ["--confirm-network", "confirmNetwork"],
]);

export function parseCliArgs(args: readonly string[]): ParseCliArgsResult {
  const globals: MutableGlobalArgs = {
    json: false,
    ndjson: false,
    yes: false,
    noColor: false,
    verbose: 0,
  };
  const commandArgs: string[] = [];
  let command: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (command !== undefined) {
      commandArgs.push(arg);
      continue;
    }

    if (arg === "--json") {
      globals.json = true;
      continue;
    }
    if (arg === "--ndjson") {
      globals.ndjson = true;
      continue;
    }
    if (arg === "--yes") {
      globals.yes = true;
      continue;
    }
    if (arg === "--no-color") {
      globals.noColor = true;
      continue;
    }
    if (/^-v+$/.test(arg)) {
      globals.verbose += arg.length - 1;
      continue;
    }
    if (arg === "--chain-id") {
      const value = args[index + 1];
      if (value === undefined) {
        return missingValue(arg);
      }
      globals.chainId = Number(value);
      index += 1;
      continue;
    }

    const stringField = stringFlags.get(arg);
    if (stringField) {
      const value = args[index + 1];
      if (value === undefined) {
        return missingValue(arg);
      }
      setStringFlag(globals, stringField, value);
      index += 1;
      continue;
    }

    command = arg;
  }

  return {
    ok: true,
    value: {
      ...(command === undefined ? {} : { command }),
      commandArgs,
      globals,
    },
  };
}

function setStringFlag(globals: MutableGlobalArgs, field: keyof GlobalArgs, value: string): void {
  switch (field) {
    case "profile":
      globals.profile = value;
      return;
    case "network":
      globals.network = value;
      return;
    case "rpcUrl":
      globals.rpcUrl = value;
      return;
    case "account":
      globals.account = value;
      return;
    case "signer":
      globals.signer = value;
      return;
    case "project":
      globals.project = value;
      return;
    case "confirmNetwork":
      globals.confirmNetwork = value;
      return;
    default:
      throw new Error(`unsupported string flag field: ${field}`);
  }
}

function missingValue(flag: string): ParseCliArgsResult {
  return {
    ok: false,
    error: createUserError({
      code: "missing_flag_value",
      message: `Missing value for ${flag}.`,
      hint: `Pass a value after ${flag}.`,
      details: { flag },
    }),
  };
}
