import {
  parseStorageLayoutJson,
  ProjectError,
  readContractArtifact,
  resolveArtifactPath,
  resolveTarget,
  type StorageMember,
  type StorageType,
} from "@consol/core";
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

  const layout = parseStorageLayoutJson(result.stdout);
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
      type_id: slot.typeId,
      type_label: layout.types[slot.typeId]?.label ?? null,
      encoding: layout.types[slot.typeId]?.encoding ?? null,
      number_of_bytes: layout.types[slot.typeId]?.numberOfBytes === undefined
        ? null
        : String(layout.types[slot.typeId]?.numberOfBytes),
    })),
    types: storageTypesPayload(layout.types),
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

function storageTypesPayload(types: Readonly<Record<string, StorageType>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(types).map(([id, type]) => [id, storageTypePayload(type)]),
  );
}

function storageTypePayload(type: StorageType): Record<string, unknown> {
  return {
    encoding: type.encoding,
    label: type.label,
    numberOfBytes: String(type.numberOfBytes),
    ...(type.base === undefined ? {} : { base: type.base }),
    ...(type.key === undefined ? {} : { key: type.key }),
    ...(type.value === undefined ? {} : { value: type.value }),
    ...(type.members === undefined || type.members.length === 0
      ? {}
      : { members: type.members.map(storageMemberPayload) }),
  };
}

function storageMemberPayload(member: StorageMember): Record<string, unknown> {
  return {
    astId: member.astId,
    contract: member.contract,
    label: member.label,
    offset: member.offset,
    slot: member.slot,
    type: member.typeId,
  };
}

function getRecordProperty(raw: unknown, key: string): Record<string, unknown> | undefined {
  const value = getProperty(raw, key);
  return isRecord(value) ? value : undefined;
}

function getProperty(raw: unknown, key: string): unknown {
  return isRecord(raw) ? raw[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
