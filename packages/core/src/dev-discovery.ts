import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { findFoundryProjectRoot } from "./project";
import { solidityDeclarations, type SolidityDeclarationKind } from "./project/solidity-declarations";

export type DevWorkspaceCandidate =
  | {
      readonly kind: "foundry_project";
      readonly label: string;
      readonly projectRoot: string;
    }
  | {
      readonly kind: "standalone_contract";
      readonly label: string;
      readonly workspaceRoot: string;
      readonly sourceFile: string;
      readonly contract: string;
      readonly target: string;
      readonly declarationKind?: SolidityDeclarationKind;
      readonly deployable?: boolean;
      readonly deployReason?: string | null;
    };

export type DevWorkspaceDiscovery =
  | {
      readonly kind: "foundry_project";
      readonly projectRoot: string;
    }
  | {
      readonly kind: "workspace";
      readonly root: string;
      readonly candidates: readonly DevWorkspaceCandidate[];
    };

export type DiscoverDevWorkspacesInput = {
  readonly cwd: string;
};

export function discoverDevWorkspaces(input: DiscoverDevWorkspacesInput): DevWorkspaceDiscovery {
  const foundry = findFoundryProjectRoot(input.cwd);
  if (foundry !== null) {
    return {
      kind: "foundry_project",
      projectRoot: realpathSync(foundry.projectRoot),
    };
  }

  const root = realpathSync(input.cwd);
  return {
    kind: "workspace",
    root,
    candidates: scanWorkspaceCandidates(root),
  };
}

function scanWorkspaceCandidates(root: string): readonly DevWorkspaceCandidate[] {
  return [...scanWorkspace(root, root)].sort(candidateSort);
}

function scanWorkspace(root: string, dir: string): readonly DevWorkspaceCandidate[] {
  if (existsSync(join(dir, "foundry.toml"))) {
    return [
      {
        kind: "foundry_project",
        label: relativeLabel(root, dir),
        projectRoot: realpathSync(dir),
      },
    ];
  }

  const candidates: DevWorkspaceCandidate[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name)) {
      continue;
    }

    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      candidates.push(...scanWorkspace(root, path));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".sol")) {
      candidates.push(...standaloneContractCandidates(root, path));
    }
  }
  return candidates;
}

function standaloneContractCandidates(root: string, sourceFile: string): readonly DevWorkspaceCandidate[] {
  const sourcePath = relativeLabel(root, sourceFile);
  return contractDeclarations(sourceFile).map((declaration) => ({
    kind: "standalone_contract",
    label: `${sourcePath}:${declaration.name}`,
    workspaceRoot: root,
    sourceFile: realpathSync(sourceFile),
    contract: declaration.name,
    target: `${sourcePath}:${declaration.name}`,
    declarationKind: declaration.kind,
    deployable: declaration.deployable,
    deployReason: declaration.deployReason,
  }));
}

function contractDeclarations(sourceFile: string) {
  return solidityDeclarations(readFileSync(sourceFile, "utf8"));
}

function candidateSort(left: DevWorkspaceCandidate, right: DevWorkspaceCandidate): number {
  if (left.kind !== right.kind) {
    return left.kind === "foundry_project" ? -1 : 1;
  }

  if (left.kind === "standalone_contract" && right.kind === "standalone_contract") {
    const sourceOrder = left.sourceFile.localeCompare(right.sourceFile);
    return sourceOrder === 0 ? 0 : sourceOrder;
  }

  return left.label.localeCompare(right.label);
}

function relativeLabel(root: string, path: string): string {
  const relativePath = relative(root, realpathSync(path)).split(sep).join("/");
  return relativePath.length === 0 ? "." : relativePath;
}

const ignoredNames = new Set([
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
