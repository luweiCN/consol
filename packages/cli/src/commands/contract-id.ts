import { readContractArtifact, resolveArtifactPath } from "@consol/core";
import type { ContractArtifact, ResolvedTarget } from "@consol/core";
import { basename, dirname } from "node:path";

export function contractIdentifier(resolved: ResolvedTarget, artifact?: ContractArtifact): string {
  const targetArtifact = artifact ?? readContractArtifact(resolveArtifactPath(resolved));
  const source = compilationTargetSource(targetArtifact.raw);
  if (source !== null) {
    return `${source}:${resolved.contractName}`;
  }

  return `src/${basename(dirname(targetArtifact.path))}:${resolved.contractName}`;
}

function compilationTargetSource(raw: unknown): string | null {
  const metadata = getRecordProperty(raw, "metadata");
  const settings = metadata === undefined ? undefined : getRecordProperty(metadata, "settings");
  const compilationTarget = settings === undefined ? undefined : getRecordProperty(settings, "compilationTarget");
  const source = compilationTarget === undefined ? undefined : Object.keys(compilationTarget)[0];
  return source ?? null;
}

function getRecordProperty(raw: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }

  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
