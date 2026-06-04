import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ProjectError, type ResolvedTarget } from "./artifacts";
import { createSingleFileScratchProject, findFoundryProjectRoot } from "./detect";
import { solidityDeclarationNames } from "./solidity-declarations";

export type ResolveTargetInput = {
  readonly cwd: string;
  readonly target?: string;
  readonly projectRoot?: string;
};

export function resolveTarget(input: ResolveTargetInput): ResolvedTarget {
  if (input.target?.includes(".sol")) {
    const projectTarget = resolveProjectFileTarget(input, input.target);
    return projectTarget ?? resolveSingleFileTarget(input, input.target);
  }

  if (input.target !== undefined) {
    return resolveProjectContractTarget(input, input.target);
  }

  return resolveProjectRootTarget(input);
}

function resolveProjectRootTarget(input: ResolveTargetInput): ResolvedTarget {
  return {
    sourceMode: "project",
    projectRoot: requireFoundryProjectRoot(input, "current directory"),
    contractName: "",
  };
}

function resolveProjectContractTarget(input: ResolveTargetInput, contractName: string): ResolvedTarget {
  return {
    sourceMode: "project",
    projectRoot: requireFoundryProjectRoot(input, "target"),
    contractName,
  };
}

function resolveProjectFileTarget(input: ResolveTargetInput, target: string): ResolvedTarget | null {
  const { file, explicitContract } = splitSourceTarget(target);
  const sourceFile = findExistingSourceFile(input, file);
  if (sourceFile === null) {
    return null;
  }

  const projectRoot = projectRootForSource(input, sourceFile);
  if (projectRoot === null) {
    return null;
  }

  return {
    sourceMode: "project",
    projectRoot,
    sourceFile,
    contractName: explicitContract === undefined || explicitContract === "" ? inferSingleContract(sourceFile) : explicitContract,
  };
}

function resolveSingleFileTarget(input: ResolveTargetInput, target: string): ResolvedTarget {
  const { file, explicitContract } = splitSourceTarget(target);
  const sourceFile = canonicalizeSourceFile(input.cwd, file);
  const contractName = explicitContract === undefined || explicitContract === "" ? inferSingleContract(sourceFile) : explicitContract;
  const scratch = createSingleFileScratchProject({ sourceFile });

  return {
    sourceMode: "single_file",
    projectRoot: scratch.projectRoot,
    sourceFile,
    contractName,
  };
}

function requireFoundryProjectRoot(input: ResolveTargetInput, context: "current directory" | "target"): string {
  const projectRoot = input.projectRoot === undefined ? detectedProjectRoot(input.cwd) : realpathSync(input.projectRoot);
  if (projectRoot !== null) {
    return projectRoot;
  }

  throw new ProjectError({
    code: "foundry_project_not_found",
    message: `No foundry.toml was found for the ${context}.`,
    hint: "Run inside a Foundry project, pass --project, or use a .sol target.",
  });
}

function projectRootForSource(input: ResolveTargetInput, sourceFile: string): string | null {
  if (input.projectRoot !== undefined) {
    const projectRoot = realpathSync(input.projectRoot);
    return isPathInside(projectRoot, sourceFile) ? projectRoot : null;
  }

  return detectedProjectRoot(dirname(sourceFile));
}

function detectedProjectRoot(start: string): string | null {
  const detected = findFoundryProjectRoot(start);
  return detected === null ? null : realpathSync(detected.projectRoot);
}

function findExistingSourceFile(input: ResolveTargetInput, file: string): string | null {
  for (const candidate of sourceFileCandidates(input, file)) {
    if (existsSync(candidate)) {
      return realpathSync(candidate);
    }
  }
  return null;
}

function canonicalizeSourceFile(cwd: string, file: string): string {
  const sourceFile = isAbsolute(file) ? file : resolve(cwd, file);
  try {
    return realpathSync(sourceFile);
  } catch (error) {
    throw new ProjectError({
      code: "source_file_not_found",
      message: `Failed to read Solidity file \`${file}\`: ${errorMessage(error)}`,
      hint: "Check the path, or run from the directory that contains the file.",
    });
  }
}

function sourceFileCandidates(input: ResolveTargetInput, file: string): readonly string[] {
  if (isAbsolute(file)) {
    return [file];
  }

  const candidates: string[] = [];
  if (input.projectRoot !== undefined) {
    candidates.push(join(input.projectRoot, file));
  }
  candidates.push(resolve(input.cwd, file));
  candidates.push(file);
  return candidates;
}

function splitSourceTarget(target: string): { readonly file: string; readonly explicitContract?: string } {
  const separator = target.indexOf(":");
  if (separator === -1) {
    return { file: target };
  }

  return {
    file: target.slice(0, separator),
    explicitContract: target.slice(separator + 1),
  };
}

function inferSingleContract(sourceFile: string): string {
  const contracts = contractNames(sourceFile);
  if (contracts.length === 1) {
    return contracts[0] ?? unreachable("expected one contract");
  }

  if (contracts.length === 0) {
    throw new ProjectError({
      code: "target_not_deployable",
      message: `No contract declaration found in ${sourceFile}.`,
      hint: "Use a file with a deployable contract or pass an explicit target.",
    });
  }

  throw new ProjectError({
    code: "target_ambiguous",
    message: `Multiple contracts found in ${sourceFile}.`,
    hint: `Use an explicit target like ${sourceFile}:<contract>. Candidates: ${contracts.join(", ")}`,
  });
}

function contractNames(sourceFile: string): string[] {
  return [...solidityDeclarationNames(readFileSync(sourceFile, "utf8"))];
}

function isPathInside(root: string, path: string): boolean {
  const normalizedPath = relative(root, path).split(sep).join("/");
  return normalizedPath === "" || (normalizedPath !== ".." && !normalizedPath.startsWith("../"));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unreachable(message: string): never {
  throw new Error(message);
}
