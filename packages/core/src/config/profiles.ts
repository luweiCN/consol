import type { NetworkMeta } from "@consol/protocol";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ProjectError, stableHash } from "../project/artifacts";
import { defaultNetworkMeta } from "./defaults";
import type { AccountProfile } from "./account-types";
import { defaultWritePolicy, detectNetworkKind, redactRpcUrl, type NetworkKind, type WritePolicy } from "./permissions";
import { resolveConfigPaths, type ConfigPathEnv } from "./paths";
import {
  networkSection,
  parseConsolConfig,
  removeNetworkSection,
  removeTopLevelKey,
  setSectionBoolean,
  setSectionString,
  setTopLevelString,
} from "./profile-toml";

export { parseConsolConfig } from "./profile-toml";

export type NetworkProfile = {
  readonly rpc_url?: string;
  readonly rpc_url_env?: string;
  readonly fork_url?: string;
  readonly fork_url_env?: string;
  readonly fork_block_number?: number;
  readonly chain_id?: number;
  readonly kind?: NetworkKind;
  readonly write_policy?: WritePolicy;
};

export type ConsolConfig = {
  readonly active_network?: string;
  readonly active_account?: string;
  readonly ui?: {
    readonly language?: string;
    readonly show_raw_state_values?: boolean;
  };
  readonly networks: Readonly<Record<string, NetworkProfile>>;
  readonly accounts: Readonly<Record<string, AccountProfile>>;
};

export type NetworkRuntime = {
  readonly meta: NetworkMeta;
  readonly rpc_url: string;
};

export function loadConsolConfig(env: ConfigPathEnv): ConsolConfig {
  const path = resolveConfigPaths({ env }).configPath;
  if (!existsSync(path)) {
    return { networks: {}, accounts: {} };
  }
  return parseConsolConfig(readFileSync(path, "utf8"));
}

export function saveNetworkProfile(input: {
  readonly env: ConfigPathEnv;
  readonly name: string;
  readonly profile: NetworkProfile;
}): string {
  const path = resolveConfigPaths({ env: input.env }).configPath;
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const next = `${removeNetworkSection(existing, input.name).trimEnd()}\n\n${networkSection(input.name, input.profile)}`.trimStart();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${next.trimEnd()}\n`, { mode: 0o600 });
  return path;
}

export function saveActiveNetwork(input: { readonly env: ConfigPathEnv; readonly name: string }): string {
  const path = resolveConfigPaths({ env: input.env }).configPath;
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${setTopLevelString(existing, "active_network", input.name).trimEnd()}\n`, { mode: 0o600 });
  return path;
}

export function saveUiLanguage(input: { readonly env: ConfigPathEnv; readonly language: "en-US" | "zh-CN" | "system" }): string {
  return saveUiSettings({
    env: input.env,
    language: input.language,
    showRawStateValues: loadConsolConfig(input.env).ui?.show_raw_state_values ?? true,
  });
}

export function saveUiSettings(input: {
  readonly env: ConfigPathEnv;
  readonly language: "en-US" | "zh-CN" | "system";
  readonly showRawStateValues: boolean;
}): string {
  const path = resolveConfigPaths({ env: input.env }).configPath;
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const withLanguage = setSectionString(existing, "[ui]", "language", input.language);
  const withRawState = setSectionBoolean(withLanguage, "[ui]", "show_raw_state_values", input.showRawStateValues);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${withRawState.trimEnd()}\n`, { mode: 0o600 });
  return path;
}

export function removeNetworkProfile(input: { readonly env: ConfigPathEnv; readonly name: string }): string {
  const path = resolveConfigPaths({ env: input.env }).configPath;
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const config = parseConsolConfig(existing);
  const withoutSection = removeNetworkSection(existing, input.name);
  const next =
    config.active_network === input.name
      ? removeTopLevelKey(withoutSection, "active_network")
      : withoutSection;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${next.trimEnd()}\n`, { mode: 0o600 });
  return path;
}

export function networkProfiles(env: ConfigPathEnv): Readonly<Record<string, NetworkProfile>> {
  const local = defaultNetworkMeta();
  return {
    ...loadConsolConfig(env).networks,
    local: {
      rpc_url: local.rpc_url,
      ...(local.chain_id === null ? {} : { chain_id: local.chain_id }),
      kind: "anvil",
      write_policy: "local",
    },
  };
}

export function activeNetworkMeta(env: ConfigPathEnv): NetworkMeta {
  return activeNetworkRuntime(env).meta;
}

export function activeNetworkRuntime(env: ConfigPathEnv): NetworkRuntime {
  const config = loadConsolConfig(env);
  const active = config.active_network ?? "local";
  const profiles = networkProfiles(env);
  const profile = profiles[active];
  if (profile === undefined) {
    throw new ProjectError({
      code: "network_not_found",
      message: `Network profile \`${active}\` does not exist.`,
      hint: "Run `consol network list` or select another network.",
    });
  }
  const rpcUrl = profile.rpc_url ?? envValue(env, profile.rpc_url_env);
  if (rpcUrl === undefined) {
    throw new ProjectError({
      code: "network_rpc_missing",
      message: `Network profile \`${active}\` requires an RPC URL.`,
      hint: "Set the configured RPC environment variable or update the network profile.",
    });
  }
  const meta = networkMetaFromProfile(active, profile, env);
  return {
    meta: meta ?? defaultNetworkMeta(),
    rpc_url: rpcUrl,
  };
}

export function networkMetaFromProfile(name: string, profile: NetworkProfile, env: ConfigPathEnv): NetworkMeta | null {
  const rpcUrl = profile.rpc_url ?? envValue(env, profile.rpc_url_env);
  if (rpcUrl === undefined) {
    return null;
  }
  const kind = profile.kind ?? detectNetworkKind(rpcUrl);
  const writePolicy =
    profile.write_policy ??
    defaultWritePolicy({
      kind,
      ...(profile.chain_id === undefined ? {} : { chainId: profile.chain_id }),
    }) ??
    "confirm";
  const chainId = profile.chain_id ?? null;
  return {
    name,
    kind,
    chain_id: chainId,
    rpc_url: redactRpcUrl(rpcUrl),
    fork_url: profile.fork_url === undefined ? null : redactRpcUrl(profile.fork_url),
    fork_block_number: profile.fork_block_number ?? null,
    fingerprint: chainId === null ? null : `${name}:${chainId}:${rpcFingerprint(rpcUrl)}`,
    write_policy: writePolicy,
  };
}

function envValue(env: ConfigPathEnv, name: string | undefined): string | undefined {
  if (name === undefined) {
    return undefined;
  }
  const value = env[name]?.trim();
  return value === "" ? undefined : value;
}

function rpcFingerprint(rpcUrl: string): string {
  return detectNetworkKind(rpcUrl) === "anvil" ? "localhost" : stableHash(rpcUrl);
}
