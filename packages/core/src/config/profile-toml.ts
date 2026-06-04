import { accountField, type AccountProfile } from "./account-types";
import type { ConsolConfig, NetworkProfile } from "./profiles";

export function removeTopLevelKey(source: string, key: string): string {
  const output: string[] = [];
  let inTopLevel = true;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (inTopLevel && trimmed.startsWith("[")) {
      inTopLevel = false;
    }
    if (inTopLevel && trimmed.startsWith(`${key} `)) {
      continue;
    }
    output.push(line);
  }
  return output.join("\n");
}

export function setTopLevelString(source: string, key: string, value: string): string {
  const lines = source.split(/\r?\n/);
  const output: string[] = [];
  let updated = false;
  let inTopLevel = true;
  for (const line of lines) {
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

export function setSectionString(source: string, header: string, key: string, value: string): string {
  return setSectionEntry(source, header, key, JSON.stringify(value));
}

export function setSectionBoolean(source: string, header: string, key: string, value: boolean): string {
  return setSectionEntry(source, header, key, value ? "true" : "false");
}

export function removeNetworkSection(source: string, name: string): string {
  return removeSection(source, `[networks.${name}]`);
}

export function networkSection(name: string, profile: NetworkProfile): string {
  return [
    `[networks.${name}]`,
    ...tomlString("rpc_url", profile.rpc_url),
    ...tomlString("rpc_url_env", profile.rpc_url_env),
    ...tomlString("fork_url", profile.fork_url),
    ...tomlString("fork_url_env", profile.fork_url_env),
    ...tomlNumber("fork_block_number", profile.fork_block_number),
    ...tomlNumber("chain_id", profile.chain_id),
    ...tomlString("kind", profile.kind),
    ...tomlString("write_policy", profile.write_policy),
  ].join("\n");
}

export function parseConsolConfig(source: string): ConsolConfig {
  const networks: Record<string, NetworkProfile> = {};
  const accounts: Record<string, AccountProfile> = {};
  let activeNetwork: string | undefined;
  let activeAccount: string | undefined;
  let uiLanguage: string | undefined;
  let uiShowRawStateValues: boolean | undefined;
  let currentNetwork: string | undefined;
  let currentAccount: string | undefined;
  let currentUi = false;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const section = /^\[networks\.([^\]]+)\]$/.exec(line);
    if (section?.[1] !== undefined) {
      currentNetwork = section[1];
      currentAccount = undefined;
      currentUi = false;
      networks[currentNetwork] = {};
      continue;
    }
    const accountSection = /^\[accounts\.([^\]]+)\]$/.exec(line);
    if (accountSection?.[1] !== undefined) {
      currentAccount = accountSection[1];
      currentNetwork = undefined;
      currentUi = false;
      accounts[currentAccount] = {};
      continue;
    }
    if (line === "[ui]") {
      currentUi = true;
      currentAccount = undefined;
      currentNetwork = undefined;
      continue;
    }
    if (line.startsWith("[")) {
      currentNetwork = undefined;
      currentAccount = undefined;
      currentUi = false;
      continue;
    }

    const entry = tomlEntry(line);
    if (entry === null) {
      continue;
    }
    if (currentNetwork === undefined) {
      if (entry.key === "active_network" && typeof entry.value === "string") {
        activeNetwork = entry.value;
      }
      if (entry.key === "active_account" && typeof entry.value === "string") {
        activeAccount = entry.value;
      }
      if (currentUi && entry.key === "language" && typeof entry.value === "string") {
        uiLanguage = entry.value;
      }
      if (currentUi && entry.key === "show_raw_state_values" && typeof entry.value === "boolean") {
        uiShowRawStateValues = entry.value;
      }
      if (currentAccount !== undefined) {
        accounts[currentAccount] = {
          ...accounts[currentAccount],
          ...accountField(entry.key, entry.value),
        };
      }
      continue;
    }

    networks[currentNetwork] = {
      ...networks[currentNetwork],
      ...networkField(entry.key, entry.value),
    };
  }

  return {
    ...(activeNetwork === undefined ? {} : { active_network: activeNetwork }),
    ...(activeAccount === undefined ? {} : { active_account: activeAccount }),
    ...(uiLanguage === undefined && uiShowRawStateValues === undefined
      ? {}
      : {
          ui: {
            ...(uiLanguage === undefined ? {} : { language: uiLanguage }),
            ...(uiShowRawStateValues === undefined ? {} : { show_raw_state_values: uiShowRawStateValues }),
          },
        }),
    networks,
    accounts,
  };
}

function setSectionEntry(source: string, header: string, key: string, value: string): string {
  if (source.trim().length === 0) {
    return `${header}\n${key} = ${value}`;
  }

  const output: string[] = [];
  let inSection = false;
  let sectionFound = false;
  let keyUpdated = false;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      if (inSection && !keyUpdated) {
        output.push(`${key} = ${value}`);
      }
      inSection = trimmed === header;
      sectionFound = sectionFound || inSection;
      keyUpdated = false;
    }

    if (inSection && trimmed.startsWith(`${key} `)) {
      if (!keyUpdated) {
        output.push(`${key} = ${value}`);
        keyUpdated = true;
      }
      continue;
    }

    output.push(line);
  }

  if (inSection && !keyUpdated) {
    output.push(`${key} = ${value}`);
  }

  if (!sectionFound) {
    output.push("", header, `${key} = ${value}`);
  }

  return output.join("\n");
}

function removeSection(source: string, header: string): string {
  const lines = source.split(/\r?\n/);
  const output: string[] = [];
  let skipping = false;
  for (const line of lines) {
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

function tomlString(key: string, value: string | undefined): readonly string[] {
  return value === undefined ? [] : [`${key} = ${JSON.stringify(value)}`];
}

function tomlNumber(key: string, value: number | undefined): readonly string[] {
  return value === undefined ? [] : [`${key} = ${value}`];
}

function tomlEntry(line: string): { readonly key: string; readonly value: string | number | boolean } | null {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line);
  const key = match?.[1];
  const rawValue = match?.[2]?.trim();
  if (key === undefined || rawValue === undefined) {
    return null;
  }
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    return { key, value: rawValue.slice(1, -1) };
  }
  if (rawValue === "true" || rawValue === "false") {
    return { key, value: rawValue === "true" };
  }
  const number = Number(rawValue);
  return Number.isFinite(number) ? { key, value: number } : null;
}

function networkField(key: string, value: string | number | boolean): NetworkProfile {
  switch (key) {
    case "rpc_url":
    case "rpc_url_env":
    case "fork_url":
    case "fork_url_env":
      return typeof value === "string" ? { [key]: value } : {};
    case "fork_block_number":
    case "chain_id":
      return typeof value === "number" ? { [key]: value } : {};
    case "kind":
      return value === "anvil" || value === "anvil-fork" || value === "remote" ? { kind: value } : {};
    case "write_policy":
      return value === "local" || value === "confirm" || value === "typed-confirm" || value === "read-only"
        ? { write_policy: value }
        : {};
    default:
      return {};
  }
}
