import { solidityDeclarations } from "@consol/core";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { GlobalArgs } from "../args";

// Narrowed view of the dev command input — only the fields target resolution
// needs. `RunDevCommandInput` structurally satisfies this.
type DevTargetContext = { readonly cwd: string; readonly globals: GlobalArgs };

export function commandTarget(commandArgs: readonly string[]): string | undefined {
  const index = commandTargetIndex(commandArgs);
  return index < 0 ? undefined : commandArgs[index];
}

export function commandTargetIndex(commandArgs: readonly string[]): number {
  return commandArgs.findIndex((arg) => arg !== "--json");
}

export function findDevDirectory(cwd: string, target: string): string | null {
  const path = isAbsolute(target) ? target : resolve(cwd, target);
  try {
    return statSync(path).isDirectory() ? realpathSync(path) : null;
  } catch {
    return null;
  }
}

export function preferredDevTarget(input: DevTargetContext, target: string): string {
  if (!target.includes(".sol")) {
    return target;
  }

  const { file, explicitContract } = splitDevSourceTarget(target);
  if (explicitContract !== undefined && explicitContract !== "") {
    return target;
  }

  const sourceFile = findDevSourceFile(input, file);
  if (sourceFile === null) {
    return target;
  }

  const declarations = solidityDeclarations(readFileSync(sourceFile, "utf8"));
  if (declarations.length <= 1) {
    return target;
  }

  const preferred = declarations.find((declaration) => declaration.deployable)?.name ?? declarations[0]?.name;
  return preferred === undefined ? target : `${file}:${preferred}`;
}

function splitDevSourceTarget(target: string): { readonly file: string; readonly explicitContract?: string } {
  const separator = target.indexOf(":");
  if (separator === -1) {
    return { file: target };
  }

  return {
    file: target.slice(0, separator),
    explicitContract: target.slice(separator + 1),
  };
}

function findDevSourceFile(input: DevTargetContext, file: string): string | null {
  for (const candidate of devSourceFileCandidates(input, file)) {
    if (existsSync(candidate)) {
      return realpathSync(candidate);
    }
  }
  return null;
}

function devSourceFileCandidates(input: DevTargetContext, file: string): readonly string[] {
  if (isAbsolute(file)) {
    return [file];
  }

  const candidates: string[] = [];
  if (input.globals.project !== undefined) {
    candidates.push(join(input.globals.project, file));
  }
  candidates.push(resolve(input.cwd, file));
  candidates.push(file);
  return candidates;
}
