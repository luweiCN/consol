import { writePrivateFile, type NetworkRuntime } from "@consol/core";
import { runCastCode } from "@consol/foundry";
import { existsSync, readFileSync } from "node:fs";
import type { CliEnv } from "../main";
import {
  deploymentEntry,
  deploymentEntryMatchesNetwork,
  readDeploymentCache,
  writeDeploymentCache,
  type DeploymentCache,
  type DeployListItem,
} from "./deploy-cache";

type ChainDeploymentSnapshotInput = {
  readonly cwd: string;
  readonly env: CliEnv;
};

export async function writeChainDeploymentSnapshot(
  input: ChainDeploymentSnapshotInput,
  network: NetworkRuntime,
  stateFile: string,
): Promise<void> {
  const cache = readDeploymentCache(input.cwd);
  const entries: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cache.entries)) {
    const entry = deploymentEntry(value);
    if (entry === null || !deploymentEntryMatchesNetwork(entry, network.meta)) {
      continue;
    }
    if (!(await deploymentEntryHasCode(input, network.rpc_url, entry))) {
      continue;
    }
    entries[key] = value;
  }

  if (Object.keys(entries).length === 0) {
    return;
  }

  writePrivateFile(chainDeploymentSnapshotFile(stateFile), `${JSON.stringify({ version: 1, entries }, null, 2)}\n`);
}

export function restoreChainDeploymentSnapshot(input: ChainDeploymentSnapshotInput, stateFile: string): void {
  const snapshot = readChainDeploymentSnapshot(stateFile);
  if (snapshot === null) {
    return;
  }

  const current = readDeploymentCache(input.cwd);
  writeDeploymentCache(input.cwd, {
    version: current.version,
    entries: { ...current.entries, ...snapshot.entries },
  });
}

function readChainDeploymentSnapshot(stateFile: string): DeploymentCache | null {
  const path = chainDeploymentSnapshotFile(stateFile);
  if (!existsSync(path)) {
    return null;
  }

  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const entries = recordProperty(raw, "entries");
  return {
    version: 1,
    entries: recordFromUnknown(entries) ?? {},
  };
}

async function deploymentEntryHasCode(
  input: ChainDeploymentSnapshotInput,
  rpcUrl: string,
  entry: DeployListItem,
): Promise<boolean> {
  const code = await runCastCode({
    cwd: input.cwd,
    env: input.env,
    rpcUrl,
    address: entry.address,
  });
  return code.ok && hasDeployedCode(code.stdout);
}

function hasDeployedCode(value: string): boolean {
  const code = value.trim();
  return code.length > 0 && code !== "0x";
}

function chainDeploymentSnapshotFile(stateFile: string): string {
  return `${stateFile}.deployments.json`;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function recordProperty(value: unknown, key: string): unknown {
  return recordFromUnknown(value)?.[key];
}
