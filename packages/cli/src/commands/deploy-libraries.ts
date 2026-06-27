import { readFileSync } from "node:fs";
import { ProjectError, solidityDeclarations } from "@consol/core";
import type { ResolvedTarget } from "@consol/core";

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
