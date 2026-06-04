import { ProjectError, readContractArtifact, resolveArtifactPath, resolveTarget } from "@consol/core";
import { runForgeBuild, runForgeInspectStorageLayout } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import { basename, dirname } from "node:path";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";

export type RunStorageCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
};

export async function runStorageCommand(input: RunStorageCommandInput): Promise<CliResult> {
  const target = commandTarget(input.commandArgs) ?? "";
  const resolved = resolveTarget({
    cwd: input.cwd,
    target,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  const artifactPath = resolveArtifactPath(resolved);
  const artifact = readContractArtifact(artifactPath);
  const build = await runForgeBuild({ cwd: resolved.projectRoot, projectRoot: resolved.projectRoot, env: input.env });
  if (!build.ok) {
    throw new ProjectError({
      code: "build_failed",
      message: "Foundry build failed.",
      hint: build.stderr || build.stdout,
    });
  }

  const contractId = contractIdentifier(artifact.raw, artifactPath, resolved.contractName);
  const result = await runForgeInspectStorageLayout({
    cwd: resolved.projectRoot,
    projectRoot: resolved.projectRoot,
    contractId,
    env: input.env,
  });
  if (!result.ok) {
    throw new ProjectError({
      code: "storage_inspect_failed",
      message: "forge inspect storage-layout failed.",
      hint: result.stderr,
    });
  }

  const layout = parseStorageLayout(result.stdout);
  const data = {
    target,
    contract: resolved.contractName,
    source_mode: resolved.sourceMode,
    project_root: resolved.projectRoot,
    storage: layout.storage.map((slot) => ({
      label: slot.label,
      slot: slot.slot,
      offset: slot.offset,
      contract: slot.contract,
      type_id: slot.type_id,
      type_label: typeField(layout.types, slot.type_id, "label"),
      encoding: typeField(layout.types, slot.type_id, "encoding"),
      number_of_bytes: typeField(layout.types, slot.type_id, "numberOfBytes"),
    })),
    types: layout.types,
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "storage",
        project_root: data.project_root,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `${data.contract} storage layout\n`, stderr: "" };
}

function commandTarget(commandArgs: readonly string[]): string | undefined {
  return commandArgs.find((arg) => arg !== "--json");
}

function contractIdentifier(rawArtifact: unknown, artifactPath: string, contractName: string): string {
  const source = artifactSource(rawArtifact);
  if (source !== undefined) {
    return `${source}:${contractName}`;
  }

  return `src/${basename(dirname(artifactPath))}:${contractName}`;
}

function artifactSource(rawArtifact: unknown): string | undefined {
  const metadata = getRecordProperty(rawArtifact, "metadata");
  const settings = getRecordProperty(metadata, "settings");
  const compilationTarget = getRecordProperty(settings, "compilationTarget");
  return compilationTarget === undefined ? undefined : Object.keys(compilationTarget)[0];
}

type StorageLayout = {
  readonly storage: readonly StorageSlot[];
  readonly types: Record<string, unknown>;
};

type StorageSlot = {
  readonly contract: string;
  readonly label: string;
  readonly offset: number;
  readonly slot: string;
  readonly type_id: string;
};

function parseStorageLayout(stdout: string): StorageLayout {
  const raw = parseJson(stdout);
  const types = getRecordProperty(raw, "types") ?? {};
  const storage = getArrayProperty(raw, "storage").map((slot) => ({
    contract: getStringProperty(slot, "contract") ?? "",
    label: getStringProperty(slot, "label") ?? "",
    offset: getNumberProperty(slot, "offset") ?? 0,
    slot: getStringProperty(slot, "slot") ?? "",
    type_id: getStringProperty(slot, "type") ?? "",
  }));

  return { storage, types };
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new ProjectError({
      code: "storage_layout_parse_failed",
      message: `Failed to parse storage layout JSON: ${error instanceof Error ? error.message : String(error)}`,
      hint: source,
    });
  }
}

function typeField(types: Record<string, unknown>, typeId: string, field: string): string | null {
  return getStringProperty(types[typeId], field) ?? null;
}

function getArrayProperty(raw: unknown, key: string): readonly unknown[] {
  const value = getProperty(raw, key);
  return Array.isArray(value) ? value : [];
}

function getRecordProperty(raw: unknown, key: string): Record<string, unknown> | undefined {
  const value = getProperty(raw, key);
  return isRecord(value) ? value : undefined;
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
  return isRecord(raw) ? raw[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
