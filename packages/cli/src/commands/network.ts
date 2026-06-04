import {
  defaultNetworkMeta,
  defaultWritePolicy,
  detectNetworkKind,
  loadConsolConfig,
  networkMetaFromProfile,
  networkProfiles,
  ProjectError,
  redactRpcUrl,
  removeNetworkProfile,
  resolveConfigPaths,
  saveNetworkProfile,
  saveActiveNetwork,
  type NetworkProfile,
} from "@consol/core";
import { createSuccessEnvelope } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import { networkKindOrUndefined, parseNetworkAddOptions, requiredNetworkName, type NetworkActionData } from "./network-options";

export type RunNetworkCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly env: CliEnv;
};

export function runNetworkCommand(input: RunNetworkCommandInput): CliResult {
  const subcommand = input.commandArgs.find((arg) => arg !== "--json");
  if (subcommand === "add") {
    return networkAdd(input);
  }
  if (subcommand === "use") {
    return networkUse(input);
  }
  if (subcommand === "remove") {
    return networkRemove(input);
  }
  if (subcommand === "status") {
    return networkStatus(input);
  }

  if (subcommand !== "list") {
    return { exitCode: 1, stdout: "", stderr: "Unsupported network command.\n" };
  }

  return networkList(input);
}

function networkList(input: RunNetworkCommandInput): CliResult {
  const config = loadConsolConfig(input.env);
  const active = input.globals.network ?? config.active_network ?? "local";
  const profiles = networkProfiles(input.env);
  const activeMeta = networkMetaFromProfile(active, profiles[active] ?? profiles.local ?? {}, input.env) ?? defaultNetworkMeta();
  const data = {
    active,
    config_path: resolveConfigPaths({ env: input.env }).configPath,
    networks: Object.entries(profiles)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, profile]) => networkListItem(name, profile, active, input.env)),
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "network list",
        network: activeMeta,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `Active network: ${data.active}\n`, stderr: "" };
}

function networkAdd(input: RunNetworkCommandInput): CliResult {
  const options = parseNetworkAddOptions(input.commandArgs);
  const configPath = saveNetworkProfile({
    env: input.env,
    name: options.name,
    profile: options.profile,
  });
  const network = networkMetaFromProfile(options.name, options.profile, input.env);
  const config = loadConsolConfig(input.env);
  const data: NetworkActionData = {
    action: "added",
    name: options.name,
    active: input.globals.network ?? config.active_network ?? "local",
    config_path: configPath,
    network,
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "network added",
        ...(network === null ? {} : { network }),
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `network added: ${data.name}\n  active: ${data.active}\n`, stderr: "" };
}

function networkUse(input: RunNetworkCommandInput): CliResult {
  const name = requiredNetworkName(input.commandArgs, "use");
  const profiles = networkProfiles(input.env);
  const profile = profiles[name];
  if (profile === undefined) {
    throw new ProjectError({
      code: "network_not_found",
      message: `Network profile \`${name}\` does not exist.`,
      hint: "Run `consol network list` to see configured profiles.",
    });
  }
  const network = networkMetaFromProfile(name, profile, input.env);

  const configPath = saveActiveNetwork({ env: input.env, name });
  const data: NetworkActionData = {
    action: "selected",
    name,
    active: name,
    config_path: configPath,
    network,
  };
  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "network selected",
        ...(network === null ? {} : { network }),
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `network selected: ${data.name}\n  active: ${data.active}\n`, stderr: "" };
}

function networkRemove(input: RunNetworkCommandInput): CliResult {
  const name = requiredNetworkName(input.commandArgs, "remove");
  if (name === "local") {
    throw new ProjectError({
      code: "network_reserved",
      message: "`local` is a built-in network profile and cannot be removed.",
    });
  }
  const config = loadConsolConfig(input.env);
  if (config.networks[name] === undefined) {
    throw new ProjectError({
      code: "network_not_found",
      message: `Network profile \`${name}\` does not exist.`,
      hint: "Run `consol network list` to see configured profiles.",
    });
  }
  const configPath = removeNetworkProfile({ env: input.env, name });
  const nextConfig = loadConsolConfig(input.env);
  const data: NetworkActionData = {
    action: "removed",
    name,
    active: input.globals.network ?? nextConfig.active_network ?? "local",
    config_path: configPath,
    network: null,
  };
  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "network removed",
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `network removed: ${data.name}\n  active: ${data.active}\n`, stderr: "" };
}

function networkStatus(input: RunNetworkCommandInput): CliResult {
  const profiles = networkProfiles(input.env);
  const config = loadConsolConfig(input.env);
  const name = networkStatusName(input.commandArgs) ?? input.globals.network ?? config.active_network ?? "local";
  const profile = profiles[name];
  const network = profile === undefined ? null : networkMetaFromProfile(name, profile, input.env);
  if (profile === undefined) {
    throw new ProjectError({
      code: "network_not_found",
      message: `Network profile \`${name}\` does not exist.`,
      hint: "Run `consol network list` to see configured profiles.",
    });
  }
  if (network === null) {
    throw new ProjectError({
      code: "network_rpc_missing",
      message: `Network profile \`${name}\` requires an RPC URL.`,
      hint: "Set the configured RPC environment variable or update the network profile.",
    });
  }

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data: network,
      meta: {
        version: VERSION,
        command: "network status",
        network,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `Network: ${network.name}\n`, stderr: "" };
}

function networkStatusName(commandArgs: readonly string[]): string | undefined {
  const index = commandArgs.findIndex((arg) => arg === "status");
  if (index === -1) {
    return undefined;
  }
  return commandArgs.slice(index + 1).find((arg) => arg !== "--json");
}

function networkListItem(name: string, profile: NetworkProfile, active: string, env: CliEnv) {
  const resolved = networkMetaFromProfile(name, profile, env);
  const kind = resolved?.kind ?? profile.kind ?? (profile.rpc_url === undefined ? "unknown" : detectNetworkKind(profile.rpc_url));
  const policyKind = networkKindOrUndefined(kind);
  return {
    name,
    active: name === active,
    rpc_url: profile.rpc_url === undefined ? null : redactRpcUrl(profile.rpc_url),
    rpc_url_env: profile.rpc_url_env ?? null,
    fork_url: profile.fork_url === undefined ? null : redactRpcUrl(profile.fork_url),
    fork_url_env: profile.fork_url_env ?? null,
    fork_block_number: profile.fork_block_number ?? null,
    expected_chain_id: profile.chain_id ?? null,
    chain_id: resolved?.chain_id ?? profile.chain_id ?? null,
    kind,
    fingerprint: resolved?.fingerprint ?? null,
    write_policy:
      resolved?.write_policy ??
      profile.write_policy ??
      defaultWritePolicy({
        ...(policyKind === undefined ? {} : { kind: policyKind }),
        ...(profile.chain_id === undefined ? {} : { chainId: profile.chain_id }),
      }) ??
      "confirm",
  };
}
