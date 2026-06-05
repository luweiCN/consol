import {
  activeAccountMeta,
  accountMetaFromSelector,
  loadConsolConfig,
  ProjectError,
  readContractArtifact,
  resolveArtifactPath,
  resolveTarget,
} from "@consol/core";
import { runCastCode } from "@consol/foundry";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContractArtifact, ResolvedTarget } from "@consol/core";
import type { AccountMeta, NetworkMeta } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv } from "../main";
import { resolveCliNetworkRuntime } from "./network-runtime";

export type ReadContext = {
  readonly resolved: ResolvedTarget;
  readonly artifact: ContractArtifact;
  readonly address: string;
  readonly network: NetworkMeta;
  readonly rpc_url: string;
  readonly account: AccountMeta;
};

type DeploymentEntry = {
  readonly contract: string;
  readonly address: string;
  readonly network: string;
  readonly network_fingerprint: string | null;
  readonly deployer: string | null;
  readonly deployed_at_unix: number;
};

export async function createReadContext(input: {
  readonly globals: GlobalArgs;
  readonly cwd: string;
  readonly env: CliEnv;
  readonly target: string;
  readonly addressOverride?: string;
  readonly ensureArtifact?: (resolved: ResolvedTarget) => Promise<void>;
}): Promise<ReadContext> {
  const resolved = resolveTarget({
    cwd: input.cwd,
    target: input.target,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  await input.ensureArtifact?.(resolved);
  const artifact = readContractArtifact(resolveArtifactPath(resolved));
  const network = resolveCliNetworkRuntime({ globals: input.globals, env: input.env });
  const account = accountFromGlobals(input.globals, input.env);
  const address = input.addressOverride ?? latestDeployment({
    projectRoot: resolved.projectRoot,
    contract: resolved.contractName,
    networkFingerprint: network.meta.fingerprint ?? network.meta.name,
    deployer: account.address ?? account.name,
  }).address;
  const code = await runCastCode({
    cwd: resolved.projectRoot,
    env: input.env,
    rpcUrl: network.rpc_url,
    address,
  });
  if (!code.ok || !hasCode(code.stdout)) {
    throw new ProjectError({
      code: "deployment_stale",
      message: `Cached address ${address} has no code on ${network.meta.name}.`,
      hint: "Redeploy the contract for the active network.",
    });
  }

  return {
    resolved,
    artifact,
    address,
    network: network.meta,
    rpc_url: network.rpc_url,
    account,
  };
}

function accountFromGlobals(globals: GlobalArgs, env: CliEnv): AccountMeta {
  const selector = globals.account ?? globals.signer;
  return selector === undefined ? activeAccountMeta(env) : accountMetaFromSelector(loadConsolConfig(env), selector);
}

function latestDeployment(input: {
  readonly projectRoot: string;
  readonly contract: string;
  readonly networkFingerprint: string;
  readonly deployer: string;
}): DeploymentEntry {
  const path = join(input.projectRoot, ".consol", "deployments.json");
  if (!existsSync(path)) {
    throw deploymentNotFound(input.contract);
  }

  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const entries = deploymentEntries(raw)
    .filter((entry) => entry.contract === input.contract)
    .filter((entry) => (entry.network_fingerprint ?? entry.network) === input.networkFingerprint)
    .filter((entry) => (entry.deployer ?? "") === input.deployer)
    .sort((left, right) => right.deployed_at_unix - left.deployed_at_unix);
  const latest = entries[0];
  if (latest === undefined) {
    throw deploymentNotFound(input.contract);
  }
  return latest;
}

function deploymentEntries(raw: unknown): readonly DeploymentEntry[] {
  const entries = getRecordProperty(raw, "entries");
  if (entries === undefined) {
    return [];
  }

  return Object.values(entries).flatMap((value) => {
    const entry = deploymentEntry(value);
    return entry === null ? [] : [entry];
  });
}

function deploymentEntry(value: unknown): DeploymentEntry | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const contract = stringValue(record.contract);
  const address = stringValue(record.address);
  const network = stringValue(record.network);
  const deployedAtUnix = numberValue(record.deployed_at_unix);
  if (contract === null || address === null || network === null || deployedAtUnix === null) {
    return null;
  }

  return {
    contract,
    address,
    network,
    network_fingerprint: stringValue(record.network_fingerprint),
    deployer: stringValue(record.deployer),
    deployed_at_unix: deployedAtUnix,
  };
}

function deploymentNotFound(contract: string): ProjectError {
  return new ProjectError({
    code: "deployment_not_found",
    message: `No deployment found for ${contract} on local.`,
    hint: "Run `consol deploy <target>` first.",
  });
}

function hasCode(value: string): boolean {
  const code = value.trim();
  return code.length > 0 && code !== "0x";
}

function getRecordProperty(raw: unknown, key: string): Record<string, unknown> | undefined {
  const value = getProperty(raw, key);
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function getProperty(raw: unknown, key: string): unknown {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>)[key] : undefined;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
