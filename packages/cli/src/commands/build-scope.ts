import type { ResolvedTarget } from "@consol/core";
import { basename, relative, sep } from "node:path";

export function targetBuildSourcePath(resolved: ResolvedTarget): string | undefined {
  if (resolved.sourceFile === undefined) {
    return undefined;
  }

  if (resolved.sourceMode === "single_file") {
    return `src/${basename(resolved.sourceFile)}`;
  }

  return relative(resolved.projectRoot, resolved.sourceFile).split(sep).join("/");
}
