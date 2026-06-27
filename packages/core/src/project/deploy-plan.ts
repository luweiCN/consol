import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { stableHash } from "./artifacts";
import { parseLinkReferences } from "./link-references";

export type DeployPlanItem = {
  readonly target: string;
  readonly contract: string;
  readonly source: string | null;
  readonly artifact_path: string;
  readonly bytecode_hash: string;
  readonly constructor_inputs: number;
  readonly deployable: boolean;
  readonly reason: string | null;
};

export function discoverDeployPlan(projectRoot: string): readonly DeployPlanItem[] {
  const items = visitJsonFiles(join(projectRoot, "out"))
    .filter((path) => !isBuildInfo(path))
    .flatMap((path) => planItemFromArtifact(path));
  const counts = contractCounts(items);

  return items
    .map((item) =>
      (counts.get(item.contract) ?? 0) > 1
        ? {
            ...item,
            deployable: false,
            reason: "duplicate contract names require file-qualified cache keys before deploy --all can deploy them",
          }
        : item,
    )
    .sort(comparePlanItems);
}

function planItemFromArtifact(path: string): readonly DeployPlanItem[] {
  const artifact = readArtifact(path);
  if (artifact === null) {
    return [];
  }

  const source = artifactSource(artifact);
  if (source !== null && !source.startsWith("src/")) {
    return [];
  }

  const contract = basename(path, ".json");
  const bytecode = bytecodeObject(artifact);
  const constructorInputs = constructorInputCount(artifact);
  const hasBytecode = bytecode !== null && isDeployableBytecode(bytecode);
  const linksLibraries = parseLinkReferences(artifact).length > 0;
  const reason = deployBlocker(hasBytecode, constructorInputs, linksLibraries);

  return [
    {
      target: contract,
      contract,
      source,
      artifact_path: path,
      bytecode_hash: bytecode === null ? "0" : stableHash(bytecode),
      constructor_inputs: constructorInputs,
      deployable: reason === null,
      reason,
    },
  ];
}

function deployBlocker(hasBytecode: boolean, constructorInputs: number, linksLibraries: boolean): string | null {
  if (!hasBytecode) {
    return "artifact has no deployable bytecode";
  }
  if (linksLibraries) {
    return "contract links external libraries; deploy it directly with `consol deploy <target>`";
  }
  if (constructorInputs > 0) {
    return `constructor requires ${constructorInputs} argument(s); deploy --all only handles zero-argument constructors`;
  }
  return null;
}

function readArtifact(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function visitJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...visitJsonFiles(path));
    } else if (entry.isFile() && path.endsWith(".json")) {
      files.push(path);
    }
  }
  return files;
}

function isBuildInfo(path: string): boolean {
  return path.split(/[\\/]/).includes("build-info");
}

function artifactSource(artifact: unknown): string | null {
  const metadata = getRecordProperty(artifact, "metadata");
  const settings = getRecordProperty(metadata, "settings");
  const compilationTarget = getRecordProperty(settings, "compilationTarget");
  return Object.keys(compilationTarget ?? {})[0] ?? null;
}

function constructorInputCount(artifact: unknown): number {
  const constructor = getArrayProperty(artifact, "abi")?.find(
    (item) => getStringProperty(item, "type") === "constructor",
  );
  return getArrayProperty(constructor, "inputs")?.length ?? 0;
}

function bytecodeObject(artifact: unknown): string | null {
  const bytecode = getProperty(artifact, "bytecode");
  if (typeof bytecode === "string") {
    return bytecode;
  }
  return getStringProperty(bytecode, "object") ?? null;
}

function isDeployableBytecode(bytecode: string): boolean {
  const value = bytecode.trim();
  return value.length > 0 && value !== "0x";
}

function contractCounts(items: readonly DeployPlanItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.contract, (counts.get(item.contract) ?? 0) + 1);
  }
  return counts;
}

function comparePlanItems(left: DeployPlanItem, right: DeployPlanItem): number {
  return (
    (left.source ?? "").localeCompare(right.source ?? "") ||
    left.contract.localeCompare(right.contract) ||
    left.artifact_path.localeCompare(right.artifact_path)
  );
}

function getArrayProperty(raw: unknown, key: string): readonly unknown[] | undefined {
  const value = getProperty(raw, key);
  return Array.isArray(value) ? value : undefined;
}

function getRecordProperty(raw: unknown, key: string): Record<string, unknown> | undefined {
  const value = getProperty(raw, key);
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function getStringProperty(raw: unknown, key: string): string | undefined {
  const value = getProperty(raw, key);
  return typeof value === "string" ? value : undefined;
}

function getProperty(raw: unknown, key: string): unknown {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>)[key] : undefined;
}
