import type { AccountMeta } from "@consol/protocol";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { defaultAccountMeta, defaultAnvilAccountMeta } from "./defaults";
import { resolveConfigPaths, type ConfigPathEnv } from "./paths";
import { loadConsolConfig, type ConsolConfig } from "./profiles";
import type { AccountProfile } from "./account-types";

export type { AccountProfile } from "./account-types";

export function saveAccountProfile(input: {
  readonly env: ConfigPathEnv;
  readonly name: string;
  readonly profile: AccountProfile;
}): string {
  const path = resolveConfigPaths({ env: input.env }).configPath;
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const next = `${removeSection(existing, `[accounts.${input.name}]`).trimEnd()}\n\n${accountSection(input.name, input.profile)}`.trimStart();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${next.trimEnd()}\n`, { mode: 0o600 });
  return path;
}

export function saveActiveAccount(input: { readonly env: ConfigPathEnv; readonly name: string }): string {
  const path = resolveConfigPaths({ env: input.env }).configPath;
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${setTopLevelString(existing, "active_account", input.name).trimEnd()}\n`, { mode: 0o600 });
  return path;
}

export function accountProfiles(env: ConfigPathEnv): Readonly<Record<string, AccountProfile>> {
  return loadConsolConfig(env).accounts;
}

export function activeAccountMeta(env: ConfigPathEnv): AccountMeta {
  const config = loadConsolConfig(env);
  if (config.active_account !== undefined) {
    return accountMetaFromSelector(config, config.active_account);
  }
  return env.ETH_PRIVATE_KEY === undefined ? defaultAccountMeta() : envAccountMeta();
}

export function accountMetaFromSelector(config: ConsolConfig, selector: string): AccountMeta {
  const anvilIndex = anvilAccountIndex(selector);
  if (anvilIndex !== null) {
    return defaultAnvilAccountMeta(anvilIndex);
  }
  if (selector === "env") {
    return envAccountMeta();
  }
  const profile = config.accounts[selector];
  if (profile !== undefined) {
    return accountMetaFromProfile(selector, profile);
  }
  return { name: selector, address: null, signer: "selected" };
}

function anvilAccountIndex(selector: string): number | null {
  const match = /^anvil([0-9])$/.exec(selector);
  return match === null ? null : Number(match[1]);
}

function envAccountMeta(): AccountMeta {
  return { name: "env", address: null, signer: "env-private-key" };
}

function accountMetaFromProfile(name: string, profile: AccountProfile): AccountMeta {
  return {
    name,
    address: profile.address ?? null,
    signer: profile.signer ?? accountProfileSigner(profile),
  };
}

function accountProfileSigner(profile: AccountProfile): string {
  if (profile.keystore !== undefined) {
    return "keystore";
  }
  if (profile.private_key_env !== undefined) {
    return "env-private-key";
  }
  return "unknown";
}

function accountSection(name: string, profile: AccountProfile): string {
  return [
    `[accounts.${name}]`,
    ...tomlString("address", profile.address),
    ...tomlString("private_key_env", profile.private_key_env),
    ...tomlString("keystore", profile.keystore),
    ...tomlString("keystore_dir", profile.keystore_dir),
    ...tomlString("password_env", profile.password_env),
    ...tomlString("signer", profile.signer),
  ].join("\n");
}

function tomlString(key: string, value: string | undefined): readonly string[] {
  return value === undefined ? [] : [`${key} = ${JSON.stringify(value)}`];
}

function removeSection(source: string, header: string): string {
  const output: string[] = [];
  let skipping = false;
  for (const line of source.split(/\r?\n/)) {
    if (line.trim() === header) {
      skipping = true;
      continue;
    }
    if (skipping && line.trim().startsWith("[")) {
      skipping = false;
    }
    if (!skipping) {
      output.push(line);
    }
  }
  return output.join("\n");
}

function setTopLevelString(source: string, key: string, value: string): string {
  const output: string[] = [];
  let updated = false;
  let inTopLevel = true;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (inTopLevel && trimmed.startsWith("[")) {
      if (!updated) {
        output.push(`${key} = ${JSON.stringify(value)}`);
        updated = true;
      }
      inTopLevel = false;
    }
    if (inTopLevel && trimmed.startsWith(`${key} `)) {
      output.push(`${key} = ${JSON.stringify(value)}`);
      updated = true;
      continue;
    }
    output.push(line);
  }
  if (!updated) {
    output.unshift(`${key} = ${JSON.stringify(value)}`);
  }
  return output.join("\n");
}
