import { ProjectError } from "@consol/core";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readDeploymentCache } from "./deploy-cache";

export type ActivityOptions = {
  readonly target: string;
  readonly limit: number;
  readonly address?: string;
};

export type ActivityStatus = {
  readonly status: string;
  readonly message: string | null;
  readonly hint: string | null;
};

export type ActivityDeploymentEntry = {
  readonly contract: string;
  readonly address: string;
  readonly chain_id: number | null;
  readonly network: string;
  readonly network_fingerprint: string | null;
  readonly deployer: string | null;
  readonly bytecode_hash: string;
  readonly constructor_args_hash: string;
  readonly deploy_tx: string | null;
  readonly deployed_at_unix: number;
};

export function parseActivityOptions(commandArgs: readonly string[]): ActivityOptions {
  let target: string | undefined;
  let address: string | undefined;
  let limit = 20;

  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (arg === undefined || arg === "--json") {
      continue;
    }
    if (arg === "--limit") {
      const parsed = Number(commandArgs[index + 1]);
      limit = Number.isFinite(parsed) ? parsed : limit;
      index += 1;
      continue;
    }
    if (arg === "--address") {
      const nextAddress = commandArgs[index + 1];
      if (nextAddress === undefined) {
        throw new ProjectError({
          code: "missing_flag_value",
          message: "Missing value for --address.",
          hint: "Pass a deployed contract address after --address.",
        });
      }
      address = nextAddress;
      index += 1;
      continue;
    }
    if (target === undefined) {
      target = arg;
    }
  }

  return {
    target: target ?? "",
    limit,
    ...(address === undefined ? {} : { address }),
  };
}

export function latestDeployment(input: {
  readonly projectRoot: string;
  readonly contract: string;
  readonly networkFingerprint: string;
  readonly deployer: string;
}): ActivityDeploymentEntry | null {
  const entries = Object.values(readDeploymentCache(input.projectRoot).entries)
    .flatMap((value) => {
      const entry = deploymentEntry(value);
      return entry === null ? [] : [entry];
    })
    .filter((entry) => entry.contract === input.contract)
    .filter((entry) => (entry.network_fingerprint ?? entry.network) === input.networkFingerprint)
    .filter((entry) => (entry.deployer ?? "") === input.deployer)
    .sort((left, right) => right.deployed_at_unix - left.deployed_at_unix);
  return entries[0] ?? null;
}

export function activityStatus(input: ActivityStatus): ActivityStatus {
  return {
    status: input.status,
    message: input.message,
    hint: input.hint,
  };
}

export function envelopeData<T>(stdout: string): T {
  const envelope = JSON.parse(stdout) as unknown;
  return getProperty(envelope, "data") as T;
}

export function recentEntries(projectRoot: string, limit: number, contract: string): readonly unknown[] {
  const path = join(projectRoot, ".consol", "transactions.json");
  if (!existsSync(path)) {
    return [];
  }

  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return [...getArrayProperty(raw, "entries")]
    .filter((entry) => entryContract(entry) === contract)
    .sort((left, right) => createdAt(right) - createdAt(left))
    .slice(0, limit);
}

function deploymentEntry(value: unknown): ActivityDeploymentEntry | null {
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
    chain_id: numberValue(record.chain_id),
    network,
    network_fingerprint: stringValue(record.network_fingerprint),
    deployer: stringValue(record.deployer),
    bytecode_hash: bytecodeHash,
    constructor_args_hash: constructorArgsHash,
    deploy_tx: stringValue(record.deploy_tx),
    deployed_at_unix: deployedAtUnix,
  };
}

function entryContract(value: unknown): string | undefined {
  return getStringProperty(value, "contract");
}

function createdAt(value: unknown): number {
  const created = getNumberProperty(value, "created_at_unix");
  return created ?? 0;
}

function getArrayProperty(raw: unknown, key: string): readonly unknown[] {
  const value = getProperty(raw, key);
  return Array.isArray(value) ? value : [];
}

function getStringProperty(raw: unknown, key: string): string | undefined {
  const value = getProperty(raw, key);
  return typeof value === "string" ? value : undefined;
}

function getNumberProperty(raw: unknown, key: string): number | undefined {
  const value = getProperty(raw, key);
  return typeof value === "number" ? value : undefined;
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
