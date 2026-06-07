import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";

export type SourceMode = "project" | "single_file";

export type ResolvedTarget = {
  readonly sourceMode: SourceMode;
  readonly projectRoot: string;
  readonly sourceFile?: string;
  readonly contractName: string;
};

export type AbiSummary = {
  readonly functions: number;
  readonly events: number;
  readonly errors: number;
  readonly constructor: boolean;
};

export type ContractArtifact = {
  readonly path: string;
  readonly abi: readonly unknown[];
  readonly abiSummary: AbiSummary;
  readonly bytecodeHash: string | null;
  readonly compilerGasEstimates: unknown | null;
  readonly raw: unknown;
};

export class ProjectError extends Error {
  readonly code: string;
  readonly hint?: string;

  constructor(input: { readonly code: string; readonly message: string; readonly hint?: string }) {
    super(input.message);
    this.name = "ProjectError";
    this.code = input.code;
    if (input.hint !== undefined) {
      this.hint = input.hint;
    }
  }
}

export function resolveArtifactPath(target: ResolvedTarget): string {
  if (target.sourceMode === "single_file") {
    if (target.sourceFile === undefined) {
      throw new ProjectError({
        code: "source_file_missing",
        message: "Single-file target did not resolve to a source file.",
        hint: "Use a target like ./Counter.sol:Counter.",
      });
    }

    return join(target.projectRoot, "out", basename(target.sourceFile), `${target.contractName}.json`);
  }

  if (target.sourceFile !== undefined) {
    return findProjectArtifactForSource(target.projectRoot, target.sourceFile, target.contractName);
  }

  return findProjectArtifact(target.projectRoot, target.contractName);
}

export function readContractArtifact(path: string): ContractArtifact {
  const raw = readArtifactJson(path);
  const abi = getArrayProperty(raw, "abi");
  if (abi === undefined) {
    throw new ProjectError({
      code: "artifact_missing_abi",
      message: `Artifact has no ABI: ${path}`,
      hint: "Run `consol build` and check that the target is deployable.",
    });
  }

  const bytecode = bytecodeObject(raw);

  return {
    path,
    abi,
    abiSummary: summarizeAbi(abi),
    bytecodeHash: bytecode === undefined ? null : stableHash(bytecode),
    compilerGasEstimates: getRecordProperty(raw, "gasEstimates") ?? null,
    raw,
  };
}

export function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const mask = (1n << 64n) - 1n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function findProjectArtifact(projectRoot: string, contractName: string): string {
  const matches = contractArtifactCandidates(projectRoot, contractName);

  if (matches.length === 1) {
    return matches[0] ?? unreachable("expected one artifact match");
  }

  if (matches.length === 0) {
    throw new ProjectError({
      code: "artifact_not_found",
      message: `Contract artifact \`${contractName}\` was not found.`,
      hint: "Run `consol build` first, or check the contract name.",
    });
  }

  throw new ProjectError({
    code: "target_ambiguous",
    message: `Multiple artifacts named \`${contractName}\` were found.`,
    hint: `Use a file-qualified target like src/${contractName}.sol:${contractName}.`,
  });
}

function findProjectArtifactForSource(projectRoot: string, sourceFile: string, contractName: string): string {
  const nameMatches = contractArtifactCandidates(projectRoot, contractName);
  const sourceMatches = nameMatches.filter((path) => artifactMatchesSource(path, projectRoot, sourceFile, contractName));

  if (sourceMatches.length === 1) {
    return sourceMatches[0] ?? unreachable("expected one source artifact match");
  }

  if (sourceMatches.length > 1) {
    throw new ProjectError({
      code: "target_ambiguous",
      message: `Multiple artifacts for \`${sourceFile}\` and \`${contractName}\` were found.`,
      hint: "Remove stale artifacts and run `consol build` again.",
    });
  }

  const cachedMatch = findCachedProjectArtifactForSource(projectRoot, sourceFile, contractName);
  if (cachedMatch !== null) {
    return cachedMatch;
  }

  if (nameMatches.length === 1) {
    return nameMatches[0] ?? unreachable("expected one name artifact match");
  }

  if (nameMatches.length === 0) {
    throw new ProjectError({
      code: "artifact_not_found",
      message: `Contract artifact \`${contractName}\` for \`${sourceFile}\` was not found.`,
      hint: "Run `consol build` first, or check the file-qualified target.",
    });
  }

  throw new ProjectError({
    code: "target_ambiguous",
    message: `Multiple artifacts named \`${contractName}\` were found, but none identify \`${sourceFile}\`.`,
    hint: "Run `forge clean && forge build` to remove stale artifacts, then try again.",
  });
}

function findCachedProjectArtifactForSource(projectRoot: string, sourceFile: string, contractName: string): string | null {
  const cache = readArtifactJsonOrNull(join(projectRoot, "cache", "solidity-files-cache.json"));
  const files = getRecordProperty(cache, "files");
  if (files === undefined) {
    return null;
  }

  const matches = new Set<string>();
  for (const [source, fileEntry] of Object.entries(files)) {
    const sourceName = getStringProperty(fileEntry, "sourceName") ?? source;
    if (!artifactSourcePathMatches(projectRoot, sourceFile, sourceName)) {
      continue;
    }

    const artifacts = getRecordProperty(fileEntry, "artifacts");
    const contract = getRecordProperty(artifacts, contractName);
    if (contract === undefined) {
      continue;
    }

    for (const compilerEntry of Object.values(contract)) {
      const profiles = isRecord(compilerEntry) ? compilerEntry : {};
      for (const profileEntry of Object.values(profiles)) {
        const relativeArtifactPath = getStringProperty(profileEntry, "path");
        if (relativeArtifactPath === undefined) {
          continue;
        }

        const artifactPath = join(projectRoot, "out", relativeArtifactPath);
        if (existsSync(artifactPath) && basename(artifactPath) === `${contractName}.json`) {
          matches.add(artifactPath);
        }
      }
    }
  }

  if (matches.size === 1) {
    return [...matches][0] ?? unreachable("expected one cached artifact match");
  }

  return null;
}

function contractArtifactCandidates(projectRoot: string, contractName: string): string[] {
  const expectedFileName = `${contractName}.json`;
  return visitJsonFiles(join(projectRoot, "out")).filter((path) => basename(path) === expectedFileName);
}

function artifactMatchesSource(
  artifactPath: string,
  projectRoot: string,
  sourceFile: string,
  contractName: string,
): boolean {
  const raw = readArtifactJsonOrNull(artifactPath);
  const compilationTarget = getCompilationTarget(raw);
  if (compilationTarget === undefined) {
    return false;
  }

  return Object.entries(compilationTarget).some(([source, name]) => {
    return name === contractName && artifactSourcePathMatches(projectRoot, sourceFile, source);
  });
}

function artifactSourcePathMatches(projectRoot: string, sourceFile: string, artifactSource: string): boolean {
  try {
    return realpathSync(join(projectRoot, artifactSource)) === realpathSync(sourceFile);
  } catch {
    return false;
  }
}

function readArtifactJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new ProjectError({
      code: "artifact_not_found",
      message: `Failed to read artifact ${path}: ${errorMessage(error)}`,
      hint: "Run `consol build` first, or check the target name.",
    });
  }
}

function readArtifactJsonOrNull(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function summarizeAbi(abi: readonly unknown[]): AbiSummary {
  let constructor = false;
  let functions = 0;
  let events = 0;
  let errors = 0;

  for (const item of abi) {
    switch (getStringProperty(item, "type")) {
      case "constructor":
        constructor = true;
        break;
      case "function":
        functions += 1;
        break;
      case "event":
        events += 1;
        break;
      case "error":
        errors += 1;
        break;
    }
  }

  return { functions, events, errors, constructor };
}

function bytecodeObject(raw: unknown): string | undefined {
  const bytecode = getProperty(raw, "bytecode");
  if (typeof bytecode === "string" && bytecode.length > 0) {
    return bytecode;
  }

  const object = getStringProperty(bytecode, "object");
  return object === "" ? undefined : object;
}

function getCompilationTarget(raw: unknown): Record<string, string> | undefined {
  const metadata = getRecordProperty(raw, "metadata");
  const settings = getRecordProperty(metadata, "settings");
  const compilationTarget = getRecordProperty(settings, "compilationTarget");
  if (compilationTarget === undefined) {
    return undefined;
  }

  const entries = Object.entries(compilationTarget).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
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
  return files.sort();
}

function getArrayProperty(raw: unknown, key: string): readonly unknown[] | undefined {
  const value = getProperty(raw, key);
  return Array.isArray(value) ? value : undefined;
}

function getRecordProperty(raw: unknown, key: string): Record<string, unknown> | undefined {
  const value = getProperty(raw, key);
  return isRecord(value) ? value : undefined;
}

function getStringProperty(raw: unknown, key: string): string | undefined {
  const value = getProperty(raw, key);
  return typeof value === "string" ? value : undefined;
}

function getProperty(raw: unknown, key: string): unknown {
  return isRecord(raw) ? raw[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unreachable(message: string): never {
  throw new Error(message);
}
