import { readFileSync } from "node:fs";
import { ProjectError, solidityDeclarations } from "@consol/core";
import type { ContractArtifact, LibraryRequirement, ResolvedTarget } from "@consol/core";
import type { ForgeLibrary } from "@consol/foundry";

export function parseLibraryOverrides(values: readonly string[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const value of values) {
    const parts = value.split(":");
    const address = parts.at(-1);
    const name = parts.at(-2);
    if (parts.length < 2 || name === undefined || address === undefined || !address.startsWith("0x")) {
      throw new ProjectError({
        code: "library_override_invalid",
        message: `Invalid --libraries entry: ${value}`,
        hint: "Use Name:0xAddress, or source:Name:0xAddress to disambiguate.",
      });
    }
    map.set(name, address);
  }
  return map;
}

export function isLibraryTarget(resolved: ResolvedTarget): boolean {
  if (resolved.sourceFile === undefined) {
    return false;
  }
  const source = safeReadSource(resolved.sourceFile);
  if (source === null) {
    return false;
  }
  return solidityDeclarations(source).some(
    (declaration) => declaration.name === resolved.contractName && declaration.kind === "library",
  );
}

function safeReadSource(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export type LibraryResolver = {
  readonly loadArtifact: (req: LibraryRequirement) => ContractArtifact;
  readonly resolveCached: (req: LibraryRequirement, bytecodeHash: string) => Promise<string | null>;
  readonly deploy: (
    req: LibraryRequirement,
    artifact: ContractArtifact,
    libraries: readonly ForgeLibrary[],
  ) => Promise<string>;
};

export async function resolveLibraries(
  artifact: ContractArtifact,
  userProvided: ReadonlyMap<string, string>,
  resolver: LibraryResolver,
  inProgress: ReadonlySet<string> = new Set(),
  resolved: Map<string, ForgeLibrary> = new Map(),
): Promise<readonly ForgeLibrary[]> {
  const links: ForgeLibrary[] = [];
  for (const req of artifact.linkReferences) {
    links.push(await resolveOne(req, userProvided, resolver, inProgress, resolved));
  }
  return links;
}

async function resolveOne(
  req: LibraryRequirement,
  userProvided: ReadonlyMap<string, string>,
  resolver: LibraryResolver,
  inProgress: ReadonlySet<string>,
  resolved: Map<string, ForgeLibrary>,
): Promise<ForgeLibrary> {
  const key = `${req.source}:${req.name}`;
  const already = resolved.get(key);
  if (already !== undefined) {
    return already;
  }

  const provided = userProvided.get(req.name);
  if (provided !== undefined) {
    return remember(resolved, key, { ...req, address: provided });
  }

  if (inProgress.has(key)) {
    throw new ProjectError({
      code: "library_cycle_detected",
      message: `Circular library dependency at ${key}.`,
      hint: "Break the cycle between these libraries before deploying.",
    });
  }

  const libArtifact = resolver.loadArtifact(req);
  const nextInProgress = new Set(inProgress).add(key);
  const dependencies = await resolveLibraries(libArtifact, userProvided, resolver, nextInProgress, resolved);

  const bytecodeHash = libArtifact.bytecodeHash ?? "";
  const cached = await resolver.resolveCached(req, bytecodeHash);
  const address = cached ?? (await resolver.deploy(req, libArtifact, dependencies));
  return remember(resolved, key, { ...req, address });
}

function remember(resolved: Map<string, ForgeLibrary>, key: string, link: ForgeLibrary): ForgeLibrary {
  resolved.set(key, link);
  return link;
}
