import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { ProjectError } from "./artifacts";

export type FoundryProjectRoot = {
  readonly projectRoot: string;
  readonly foundryToml: string;
};

export type SingleFileScratchInput = {
  readonly sourceFile: string;
};

export type SingleFileScratchProject = {
  readonly projectRoot: string;
  readonly sourceFile: string;
};

export function findFoundryProjectRoot(start: string): FoundryProjectRoot | null {
  let current = resolve(start);

  while (true) {
    const foundryToml = join(current, "foundry.toml");
    if (existsSync(foundryToml)) {
      return { projectRoot: current, foundryToml };
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function createSingleFileScratchProject(input: SingleFileScratchInput): SingleFileScratchProject {
  const sourceRoot = dirname(realpathSync(input.sourceFile));
  const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-single-file-")));
  const srcRoot = join(projectRoot, "src");
  const entryFile = join(srcRoot, basename(input.sourceFile));

  mkdirSync(srcRoot, { recursive: true });
  writeFileSync(join(projectRoot, "foundry.toml"), '[profile.default]\nsrc = "src"\nout = "out"\n');
  copyImportGraph(realpathSync(input.sourceFile), sourceRoot, srcRoot);

  return { projectRoot, sourceFile: entryFile };
}

function copyImportGraph(sourceFile: string, sourceRoot: string, scratchSrcRoot: string, seen = new Set<string>()): void {
  if (seen.has(sourceFile)) {
    return;
  }
  seen.add(sourceFile);

  const relativePath = relative(sourceRoot, sourceFile);
  if (relativePath.startsWith("..")) {
    throw new Error("single_file_import_outside_root");
  }

  const destination = join(scratchSrcRoot, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(sourceFile, destination);

  const source = readFileSync(sourceFile, "utf8");
  for (const specifier of localImportSpecifiers(source)) {
    const importPath = resolve(dirname(sourceFile), specifier);
    if (isOutsideRoot(relative(sourceRoot, importPath))) {
      throw new Error("single_file_import_outside_root");
    }
    if (!existsSync(importPath)) {
      throw new ProjectError({
        code: "single_file_import_not_found",
        message: `Imported Solidity file not found: ${importPath}`,
        hint: "Fix the local import path or open the containing Foundry project.",
      });
    }
    const imported = realpathSync(importPath);
    copyImportGraph(imported, sourceRoot, scratchSrcRoot, seen);
  }
}

function localImportSpecifiers(source: string): readonly string[] {
  return [...source.matchAll(/\bimport\s+(?:"([^"]+)"|'([^']+)')/g)]
    .map((match) => match[1] ?? match[2])
    .filter((specifier): specifier is string => specifier !== undefined && specifier.startsWith("."));
}

function isOutsideRoot(relativePath: string): boolean {
  const normalizedPath = relativePath.split(sep).join("/");
  return normalizedPath === ".." || normalizedPath.startsWith("../");
}
