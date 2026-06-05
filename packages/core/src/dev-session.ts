import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import {
  parseConstructorItem,
  parseFunctionItem,
  ProjectError,
  readContractArtifact,
  resolveArtifactPath,
  resolveTarget,
  type AbiSummary,
  type ConstructorItem,
  type FunctionItem,
  type ResolvedTarget,
} from "./project";
import { discoverDevWorkspaces } from "./dev-discovery";
import { solidityDeclarations, type SolidityDeclarationKind } from "./project/solidity-declarations";

export type DevSession = {
  readonly target: string;
  readonly contract: string;
  readonly sourceMode: "project" | "single_file";
  readonly projectRoot: string;
  readonly workspaceRoot?: string;
  readonly sourceFile: string | null;
  readonly sourceFiles: readonly string[];
  readonly sourceTargets: readonly DevSourceTarget[];
  readonly artifactPath: string;
  readonly abiSummary: AbiSummary;
  readonly constructor: ConstructorItem | null;
  readonly functions: readonly FunctionItem[];
  readonly declarationKind?: SolidityDeclarationKind;
  readonly deployable?: boolean;
  readonly deployReason?: string | null;
};

export type DevSourceTarget = {
  readonly sourceFile: string;
  readonly contract: string;
  readonly target: string;
  readonly declarationKind?: SolidityDeclarationKind;
  readonly deployable?: boolean;
  readonly deployReason?: string | null;
};

export type CreateDevSessionInput = {
  readonly cwd: string;
  readonly target: string;
  readonly projectRoot?: string;
};

export type ResolvedDevSession = {
  readonly target: string;
  readonly resolved: ResolvedTarget;
};

export function resolveDevSession(input: CreateDevSessionInput): ResolvedDevSession {
  const target = devSessionTarget(input);
  const resolved = resolveTarget({
    cwd: input.cwd,
    target,
    ...(input.projectRoot === undefined ? {} : { projectRoot: input.projectRoot }),
  });
  return { target, resolved };
}

export function createDevSession(input: CreateDevSessionInput): DevSession {
  return createDevSessionFromResolved(resolveDevSession(input));
}

export function createDevSessionFromResolved(input: ResolvedDevSession): DevSession {
  const { target, resolved } = input;
  const artifactPath = resolveArtifactPath(resolved);
  const artifact = readContractArtifact(artifactPath);
  const sourceFile = sessionSourceFile({ projectRoot: resolved.projectRoot, resolvedSourceFile: resolved.sourceFile, artifactRaw: artifact.raw });
  const sourceTargets = listSourceTargets(resolved.projectRoot);
  const activeSourceTarget = sourceTargets.find((item) => item.contract === resolved.contractName && (sourceFile === null || item.sourceFile === sourceFile));

  return {
    target,
    contract: resolved.contractName,
    sourceMode: resolved.sourceMode,
    projectRoot: resolved.projectRoot,
    sourceFile,
    sourceFiles: listSoliditySourceFiles(resolved.projectRoot),
    sourceTargets,
    artifactPath,
    abiSummary: artifact.abiSummary,
    constructor: constructorItem(artifact.abi),
    functions: artifact.abi.filter((item) => abiType(item) === "function").map(parseFunctionItem).sort(functionSort),
    ...(activeSourceTarget?.declarationKind === undefined ? {} : { declarationKind: activeSourceTarget.declarationKind }),
    ...(activeSourceTarget?.deployable === undefined ? {} : { deployable: activeSourceTarget.deployable }),
    ...(activeSourceTarget?.deployReason === undefined ? {} : { deployReason: activeSourceTarget.deployReason }),
  };
}

function devSessionTarget(input: CreateDevSessionInput): string {
  if (input.target.trim().length > 0) {
    return input.target;
  }

  const project = tryResolveProjectRoot(input);
  if (project !== null) {
    const sourceTargets = listSourceTargets(project.projectRoot);
    const sourceTarget = sourceTargets.find((target) => target.deployable !== false) ?? sourceTargets[0];
    if (sourceTarget !== undefined) {
      return sourceTarget.target;
    }

    throw new ProjectError({
      code: "dev_source_contract_not_found",
      message: "No Solidity contract declaration was found for the dev workspace.",
      hint: "Create a contract under src/, contracts/, test/, script/, or pass an explicit target.",
    });
  }

  const sourceTargets = standaloneSourceTargets(input.cwd);
  if (sourceTargets.length === 1) {
    return sourceTargets[0]?.target ?? unreachable("expected one source target");
  }

  if (sourceTargets.length > 1) {
    throw new ProjectError({
      code: "dev_source_contract_ambiguous",
      message: "Multiple Solidity contracts were found outside a Foundry project.",
      hint: `Pass an explicit target like ${sourceTargets[0]?.target ?? "path/to/Contract.sol:Contract"}. Candidates: ${sourceTargets
        .slice(0, 5)
        .map((target) => target.target)
        .join(", ")}`,
    });
  }

  throw new ProjectError({
    code: "dev_source_contract_not_found",
    message: "No Solidity contract declaration was found for the dev workspace.",
    hint: "Run inside a Foundry project, pass a .sol target, or run from a directory with one Solidity contract.",
  });
}

function standaloneSourceTargets(cwd: string): readonly DevSourceTarget[] {
  const discovery = discoverDevWorkspaces({ cwd });
  if (discovery.kind !== "workspace") {
    return [];
  }

  return discovery.candidates.flatMap((candidate) =>
    candidate.kind === "standalone_contract"
      ? [{
          sourceFile: sourceFileFromTarget(candidate.target),
          contract: candidate.contract,
          target: candidate.target,
          ...(candidate.declarationKind === undefined ? {} : { declarationKind: candidate.declarationKind }),
          ...(candidate.deployable === undefined ? {} : { deployable: candidate.deployable }),
          ...(candidate.deployReason === undefined ? {} : { deployReason: candidate.deployReason }),
        }]
      : [],
  );
}

function tryResolveProjectRoot(input: CreateDevSessionInput): ResolvedTarget | null {
  try {
    return resolveTarget({
      cwd: input.cwd,
      ...(input.projectRoot === undefined ? {} : { projectRoot: input.projectRoot }),
    });
  } catch (error) {
    if (error instanceof ProjectError && error.code === "foundry_project_not_found") {
      return null;
    }
    throw error;
  }
}

function unreachable(message: string): never {
  throw new Error(message);
}

function sourceFileFromTarget(target: string): string {
  return target.split(":")[0] ?? target;
}

function listSourceTargets(projectRoot: string): readonly DevSourceTarget[] {
  return listSoliditySourceFiles(projectRoot).flatMap((sourceFile) =>
    sourceDeclarations(join(projectRoot, sourceFile)).map((declaration) => ({
      sourceFile,
      contract: declaration.name,
      target: `${sourceFile}:${declaration.name}`,
      declarationKind: declaration.kind,
      deployable: declaration.deployable,
      deployReason: declaration.deployReason,
    })),
  );
}

function sessionSourceFile(input: {
  readonly projectRoot: string;
  readonly resolvedSourceFile: string | undefined;
  readonly artifactRaw: unknown;
}): string | null {
  if (input.resolvedSourceFile !== undefined && isPathInside(input.projectRoot, input.resolvedSourceFile)) {
    return relativeSourcePath(input.projectRoot, input.resolvedSourceFile);
  }

  return artifactCompilationSource(input.artifactRaw);
}

function isPathInside(root: string, path: string): boolean {
  const normalizedPath = relative(realpathSync(root), realpathSync(path)).split(sep).join("/");
  return normalizedPath === "" || (normalizedPath !== ".." && !normalizedPath.startsWith("../"));
}

function listSoliditySourceFiles(projectRoot: string): readonly string[] {
  const sourceRoots = ["src", "contracts", "test", "script"] as const;
  const focusedFiles = [
    ...sourceRoots.flatMap((root) => sourceRootFiles(projectRoot, root)),
    ...rootSolidityFiles(projectRoot),
  ];
  const files = focusedFiles.length > 0 ? focusedFiles : [...visitSourceFiles(projectRoot)].sort();
  return files
    .filter((path) => path.endsWith(".sol"))
    .map((path) => relativeSourcePath(projectRoot, path));
}

function sourceRootFiles(projectRoot: string, root: string): readonly string[] {
  const path = join(projectRoot, root);
  return existsSync(path) && statSync(path).isDirectory() ? [...visitSourceFiles(path)].sort() : [];
}

function rootSolidityFiles(projectRoot: string): readonly string[] {
  return readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sol"))
    .map((entry) => join(projectRoot, entry.name))
    .sort();
}

function visitSourceFiles(dir: string): readonly string[] {
  const ignored = new Set([
    ".astro",
    ".consol",
    ".git",
    ".next",
    ".runtime",
    "build",
    "cache",
    "coverage",
    "dist",
    "node_modules",
    "out",
    "target",
  ]);
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) {
      continue;
    }

    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...visitSourceFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function relativeSourcePath(projectRoot: string, path: string): string {
  return relative(realpathSync(projectRoot), realpathSync(path)).split(sep).join("/");
}

function sourceDeclarations(path: string) {
  return solidityDeclarations(readFileSync(path, "utf8"));
}

function artifactCompilationSource(raw: unknown): string | null {
  const metadata = recordProperty(raw, "metadata");
  const settings = recordProperty(metadata, "settings");
  const compilationTarget = recordProperty(settings, "compilationTarget");
  return Object.keys(compilationTarget ?? {}).sort()[0] ?? null;
}

function functionSort(left: FunctionItem, right: FunctionItem): number {
  return functionKindRank(left.kind) - functionKindRank(right.kind)
    || functionInputRank(left) - functionInputRank(right)
    || left.signature.localeCompare(right.signature);
}

function functionKindRank(kind: FunctionItem["kind"]): number {
  return kind === "read" ? 0 : kind === "write" ? 1 : 2;
}

function functionInputRank(item: FunctionItem): number {
  return item.kind === "read" && item.inputs.length > 0 ? 0 : 1;
}

function recordProperty(raw: unknown, key: string): Record<string, unknown> | undefined {
  const value = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>)[key] : undefined;
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function constructorItem(abi: readonly unknown[]): ConstructorItem | null {
  const item = abi.find((entry) => abiType(entry) === "constructor");
  return item === undefined ? null : parseConstructorItem(item);
}

function abiType(item: unknown): string | undefined {
  return typeof item === "object" && item !== null && !Array.isArray(item) && "type" in item
    ? String(item.type)
    : undefined;
}
