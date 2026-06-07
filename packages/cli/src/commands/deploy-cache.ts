import { ProjectError, stableHash, writePrivateFile } from "@consol/core";
import type { ResolvedTarget } from "@consol/core";
import type { NetworkMeta } from "@consol/protocol";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type DeployListItem = {
  readonly contract: string;
  readonly address: string;
  readonly network: string;
  readonly network_fingerprint: string | null;
  readonly chain_id: number | null;
  readonly deployer: string | null;
  readonly deploy_tx: string | null;
  readonly deployed_at_unix: number;
  readonly bytecode_hash: string;
  readonly constructor_args_hash: string;
  readonly deployment_value: string | null;
};

export type DeploymentCache = {
  readonly version: number;
  readonly entries: Record<string, unknown>;
};

export function deploymentEntries(projectRoot: string): DeployListItem[] {
  const cache = readDeploymentCache(projectRoot);
  return Object.values(cache.entries).flatMap((value) => {
    const item = deploymentEntry(value);
    return item === null ? [] : [item];
  });
}

export async function pruneMissingDeploymentEntries(
  projectRoot: string,
  input: {
    readonly matches: (entry: DeployListItem) => boolean;
    readonly hasCode: (entry: DeployListItem) => Promise<boolean>;
  },
): Promise<readonly DeployListItem[]> {
  const cache = readDeploymentCache(projectRoot);
  const nextEntries: Record<string, unknown> = {};
  const entries: DeployListItem[] = [];
  let changed = false;

  for (const [key, value] of Object.entries(cache.entries)) {
    const item = deploymentEntry(value);
    if (item === null || !input.matches(item)) {
      nextEntries[key] = value;
      continue;
    }

    if (!(await input.hasCode(item))) {
      changed = true;
      continue;
    }

    nextEntries[key] = value;
    entries.push(item);
  }

  if (changed) {
    writeDeploymentCache(projectRoot, { ...cache, entries: nextEntries });
  }

  return entries;
}

export function deploymentEntryMatchesNetwork(
  entry: DeployListItem,
  network: Pick<NetworkMeta, "name" | "fingerprint" | "chain_id">,
): boolean {
  const entryNetwork = entry.network_fingerprint ?? entry.network;
  const matchesNetwork = entryNetwork === network.fingerprint || entryNetwork === network.name;
  const matchesChain = entry.chain_id === null || network.chain_id === null || entry.chain_id === network.chain_id;
  return matchesNetwork && matchesChain;
}

export function readDeploymentCache(projectRoot: string): DeploymentCache {
  const path = deploymentCachePath(projectRoot);
  if (!existsSync(path)) {
    return { version: 1, entries: {} };
  }

  const raw = parseDeploymentCacheFile(path);
  const version = getNumberProperty(raw, "version") ?? 1;
  const entries = getRecordProperty(raw, "entries") ?? {};
  return { version, entries };
}

function parseDeploymentCacheFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new ProjectError({
      code: "deployment_cache_invalid",
      message: `Deployment cache is not valid JSON: ${path}`,
      hint: error instanceof Error ? error.message : "Fix or remove the deployment cache file.",
    });
  }
}

export function writeDeploymentCache(projectRoot: string, cache: DeploymentCache): void {
  const path = deploymentCachePath(projectRoot);
  writePrivateFile(path, JSON.stringify(cache, null, 2));
}

export function deploymentEntry(value: unknown): DeployListItem | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const contract = stringValue(record.contract);
  const address = stringValue(record.address);
  const network = stringValue(record.network);
  const deployedAtUnix = numberValue(record.deployed_at_unix);
  const bytecodeHash = stringValue(record.bytecode_hash);
  const constructorArgsHash = stringValue(record.constructor_args_hash);
  if (
    contract === null ||
    address === null ||
    network === null ||
    deployedAtUnix === null ||
    bytecodeHash === null ||
    constructorArgsHash === null
  ) {
    return null;
  }

  return {
    contract,
    address,
    network,
    network_fingerprint: stringValue(record.network_fingerprint),
    chain_id: numberValue(record.chain_id),
    deployer: stringValue(record.deployer),
    deploy_tx: stringValue(record.deploy_tx),
    deployed_at_unix: deployedAtUnix,
    bytecode_hash: bytecodeHash,
    constructor_args_hash: constructorArgsHash,
    deployment_value: stringValue(record.deployment_value),
  };
}

export function argsHash(args: readonly string[]): string {
  return stableHash(args.join("\u001f"));
}

export function deploymentCacheKey(input: {
  readonly resolved: ResolvedTarget;
  readonly bytecodeHash: string;
  readonly constructorArgsHash: string;
  readonly value: string | null;
  readonly networkName: string;
  readonly deployer: string;
}): string {
  return `${input.resolved.contractName}:${input.bytecodeHash}:${input.constructorArgsHash}:${input.value ?? "0"}:${input.networkName}:${input.deployer}`;
}

export function contractNameFromTarget(target: string): string {
  const afterColon = target.split(":").at(-1) ?? target;
  const withoutPath = afterColon.split(/[\\/]/).at(-1) ?? afterColon;
  return withoutPath.endsWith(".sol") ? withoutPath.slice(0, -".sol".length) : withoutPath;
}

function deploymentCachePath(projectRoot: string): string {
  return join(projectRoot, ".consol", "deployments.json");
}

function getRecordProperty(raw: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }

  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function getNumberProperty(raw: unknown, key: string): number | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }

  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
