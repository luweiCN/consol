import type { DevSession, DevWorkspaceCandidate } from "@consol/core";
import type { SourcePreview } from "@consol/tui";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const maxPreviewLines = 180;

export function sourcePreviewsForSession(session: DevSession): readonly SourcePreview[] {
  return [...new Set(session.sourceTargets.map((target) => target.sourceFile))].flatMap((sourceFile) => {
    const sourcePath = resolveSourcePath(session.workspaceRoot ?? session.projectRoot, sourceFile);
    const lines = sourceCodePreview(sourcePath);
    return lines.length === 0 ? [] : [{ target: sourceFile, lines }];
  });
}

export function sourcePreviewLinesForCandidate(candidate: DevWorkspaceCandidate): readonly string[] {
  if (candidate.kind !== "standalone_contract") {
    return [];
  }

  return sourceCodePreview(resolveSourcePath(candidate.workspaceRoot, sourceFileFromTarget(candidate.target)), candidate.contract);
}

function sourceCodePreview(sourcePath: string, contract?: string): readonly string[] {
  if (!existsSync(sourcePath)) {
    return [];
  }

  const lines = readFileSync(sourcePath, "utf8").replaceAll("\t", "  ").split(/\r?\n/);
  const declarationIndex = contract === undefined ? -1 : lines.findIndex((line) => contractDeclarationPattern(contract).test(line));
  const start = declarationIndex < 0 ? 0 : Math.max(0, declarationIndex - 4);
  return lines.slice(start, start + maxPreviewLines).map((line, index) => `${String(start + index + 1).padStart(4)} | ${line}`);
}

function resolveSourcePath(root: string, sourceFile: string): string {
  return isAbsolute(sourceFile) ? sourceFile : join(root, sourceFile);
}

function sourceFileFromTarget(target: string): string {
  return target.split(":")[0] ?? target;
}

function contractDeclarationPattern(contract: string): RegExp {
  return new RegExp(`\\b(contract|interface|library)\\s+${escapeRegExp(contract)}\\b`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
