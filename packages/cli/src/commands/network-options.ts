import { defaultWritePolicy, detectNetworkKind, ProjectError, type NetworkKind, type NetworkProfile, type WritePolicy } from "@consol/core";
import type { NetworkMeta } from "@consol/protocol";

export type NetworkActionData = {
  readonly action: "added" | "selected" | "removed";
  readonly name: string;
  readonly active: string;
  readonly config_path: string;
  readonly network: NetworkMeta | null;
};

export type NetworkAddOptions = {
  readonly name: string;
  readonly profile: NetworkProfile;
};

export function parseNetworkAddOptions(commandArgs: readonly string[]): NetworkAddOptions {
  const name = requiredNetworkName(commandArgs, "add");
  if (name === "local") {
    throw new ProjectError({
      code: "network_reserved",
      message: "`local` is a built-in network profile.",
      hint: "Use a different profile name.",
    });
  }

  let rpcUrl: string | undefined;
  let rpcUrlEnv: string | undefined;
  let chainId: number | undefined;
  let writePolicy: WritePolicy | undefined;
  for (let index = 2; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (arg === undefined || arg === "--json") {
      continue;
    }
    if (arg === "--rpc-url") {
      rpcUrl = requiredValue(commandArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--rpc-url-env") {
      rpcUrlEnv = requiredValue(commandArgs, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--chain-id") {
      chainId = Number(requiredValue(commandArgs, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--write-policy") {
      writePolicy = parseWritePolicy(requiredValue(commandArgs, index, arg));
      index += 1;
      continue;
    }
    throw new ProjectError({
      code: "network_arg_unsupported",
      message: `Unsupported network add argument: ${arg}`,
      hint: "Use `consol network add <name> --rpc-url <url> --chain-id <id>`.",
    });
  }

  if (rpcUrl === undefined && rpcUrlEnv === undefined) {
    throw new ProjectError({
      code: "network_rpc_missing",
      message: "Network add requires `--rpc-url` or `--rpc-url-env`.",
      hint: "Example: `consol network add sepolia --rpc-url-env SEPOLIA_RPC_URL --chain-id 11155111`.",
    });
  }
  if (chainId === undefined || !Number.isInteger(chainId)) {
    throw new ProjectError({
      code: "network_chain_id_missing",
      message: "Remote network add requires `--chain-id`.",
      hint: "Use `--chain-id 11155111` for Sepolia or the expected chain id for this RPC.",
    });
  }

  const kind = rpcUrl === undefined ? undefined : detectNetworkKind(rpcUrl);
  const defaultPolicy = defaultWritePolicy({
    ...(kind === undefined ? {} : { kind }),
    chainId,
  });
  const resolvedPolicy = writePolicy ?? defaultPolicy;
  return {
    name,
    profile: {
      ...(rpcUrl === undefined ? {} : { rpc_url: rpcUrl }),
      ...(rpcUrlEnv === undefined ? {} : { rpc_url_env: rpcUrlEnv }),
      chain_id: chainId,
      ...(kind === undefined ? {} : { kind }),
      ...(resolvedPolicy === undefined ? {} : { write_policy: resolvedPolicy }),
    },
  };
}

export function requiredNetworkName(commandArgs: readonly string[], subcommand: "add" | "use" | "remove"): string {
  const name = commandArgs[1];
  if (name === undefined || name.startsWith("--")) {
    throw new ProjectError({
      code: "network_name_required",
      message: "Missing network profile name.",
      hint: `Use \`consol network ${subcommand} <name>\`.`,
    });
  }
  return name;
}

export function parseWritePolicy(value: string): WritePolicy {
  if (value === "local" || value === "confirm" || value === "typed-confirm" || value === "read-only") {
    return value;
  }
  throw new ProjectError({
    code: "write_policy_invalid",
    message: `Unsupported write policy: ${value}`,
    hint: "Use `local`, `confirm`, `typed-confirm`, or `read-only`.",
  });
}

export function networkKindOrUndefined(value: string): NetworkKind | undefined {
  return value === "anvil" || value === "anvil-fork" || value === "remote" ? value : undefined;
}

function requiredValue(commandArgs: readonly string[], index: number, flag: string): string {
  const value = commandArgs[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new ProjectError({
      code: "missing_flag_value",
      message: `Missing value for ${flag}.`,
      hint: `Pass a value after ${flag}.`,
    });
  }
  return value;
}
