import {
  accountMetaFromSelector,
  defaultAnvilAccountMetas,
  loadConsolConfig,
  networkMetaFromProfile,
  networkProfiles,
} from "@consol/core";
import type { RunDevShellInput } from "@consol/tui";
import type { GlobalArgs } from "../args";
import type { CliEnv } from "../main";

export type DevOptionsInput = {
  readonly globals: GlobalArgs;
  readonly env: CliEnv;
};

export function devNetworkOptions(input: DevOptionsInput): NonNullable<RunDevShellInput["networkOptions"]> {
  const config = loadConsolConfig(input.env);
  const activeNetworkName = input.globals.network ?? config.active_network ?? "local";
  return Object.entries(networkProfiles(input.env))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, profile]) => {
      const meta = networkMetaFromProfile(name, profile, input.env);
      const kind = meta?.kind ?? profile.kind ?? "unknown";
      const chain = meta?.chain_id ?? profile.chain_id ?? null;
      const writePolicy = meta?.write_policy ?? profile.write_policy ?? "confirm";
      return {
        name,
        label: `${name}${chain === null ? "" : ` #${chain}`} / ${kind} / ${writePolicy}`,
        active: name === activeNetworkName,
        meta: [
          `rpc: ${rpcHost(meta?.rpc_url)}`,
          meta?.fingerprint === undefined || meta.fingerprint === null ? "" : `fingerprint: ${meta.fingerprint}`,
        ].filter((part) => part.length > 0).join(" / "),
      };
    });
}

export function devAccountOptions(input: DevOptionsInput): NonNullable<RunDevShellInput["accountOptions"]> {
  const config = loadConsolConfig(input.env);
  const activeAccountName =
    input.globals.account ??
    input.globals.signer ??
    config.active_account ??
    (input.env.ETH_PRIVATE_KEY === undefined ? "anvil0" : "env");
  return [
    ...defaultAnvilAccountMetas(),
    ...(input.env.ETH_PRIVATE_KEY === undefined
      ? []
      : [{ name: "env", address: null, signer: "env-private-key" }]),
    ...Object.keys(config.accounts)
      .sort((left, right) => left.localeCompare(right))
      .map((name) => accountMetaFromSelector(config, name)),
  ].map((account) => ({
    name: account.name,
    label: `${account.name} / ${shortAddress(account.address)} / ${account.signer}`,
    ...(account.address === null ? {} : { copyValue: account.address }),
    active: account.name === activeAccountName,
  }));
}

function shortAddress(address: string | null): string {
  return address === null ? "no address" : `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function rpcType(rpcUrl: string | undefined): string {
  if (rpcUrl === undefined) {
    return "unknown";
  }

  try {
    const url = new URL(rpcUrl);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" ? "localhost" : "remote";
  } catch {
    return "custom";
  }
}

function rpcHost(rpcUrl: string | undefined): string {
  if (rpcUrl === undefined) {
    return "unknown";
  }

  try {
    const url = new URL(rpcUrl);
    return `${rpcType(rpcUrl)}:${url.host}`;
  } catch {
    return rpcType(rpcUrl);
  }
}
