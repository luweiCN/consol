import {
  createDevSessionFromResolved,
  discoverDevWorkspaces,
  ProjectError,
  resolveDevSession,
  type DevSession,
  type DevSourceTarget,
  type DevWorkspaceCandidate,
  type ResolvedDevSession,
} from "@consol/core";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Locale } from "@consol/i18n";
import type { RunDevShellInput } from "@consol/tui";
import { sourcePreviewLinesForCandidate } from "./dev-source-preview";

export type DevEntryLaunchInput = {
  readonly cwd: string;
  readonly locale: Locale;
  readonly networkOptions: NonNullable<RunDevShellInput["networkOptions"]>;
  readonly accountOptions: NonNullable<RunDevShellInput["accountOptions"]>;
  readonly ensureDevArtifact: (prepared: ResolvedDevSession) => Promise<void>;
  readonly onFunctionInputSubmit: NonNullable<RunDevShellInput["onFunctionInputSubmit"]>;
  readonly onConfirmedTxPreview: NonNullable<RunDevShellInput["onConfirmedTxPreview"]>;
  readonly onStateSnapshotRequest: NonNullable<RunDevShellInput["onStateSnapshotRequest"]>;
  readonly onStateKeyBookChange: NonNullable<RunDevShellInput["onStateKeyBookChange"]>;
  readonly onTransactionsRequest: NonNullable<RunDevShellInput["onTransactionsRequest"]>;
  readonly onDeployedContractsRequest: NonNullable<RunDevShellInput["onDeployedContractsRequest"]>;
  readonly onEventRecordsRequest: NonNullable<RunDevShellInput["onEventRecordsRequest"]>;
  readonly onSourcePreviewsRequest: NonNullable<RunDevShellInput["onSourcePreviewsRequest"]>;
  readonly onBuildRequest: NonNullable<RunDevShellInput["onBuildRequest"]>;
  readonly onAccountStatusRequest: NonNullable<RunDevShellInput["onAccountStatusRequest"]>;
  readonly onBlockWatchStart: NonNullable<RunDevShellInput["onBlockWatchStart"]>;
  readonly settings: NonNullable<RunDevShellInput["settings"]>;
  readonly onSettingsChange: NonNullable<RunDevShellInput["onSettingsChange"]>;
  readonly copyToSystemClipboard?: RunDevShellInput["copyToSystemClipboard"];
};

export type DevSourceFileSelectInput = {
  readonly cwd: string;
  readonly ensureDevArtifact: (prepared: ResolvedDevSession) => Promise<void>;
};

export function createEntryLaunchInput(input: DevEntryLaunchInput): RunDevShellInput | null {
  const discovery = discoverDevWorkspaces({ cwd: input.cwd });
  if (discovery.kind !== "workspace" || !shouldOpenEntryPicker(discovery.candidates)) {
    return null;
  }

  const candidates = discovery.candidates;
  return {
    locale: input.locale,
    networkOptions: input.networkOptions,
    accountOptions: input.accountOptions,
    settings: input.settings,
    entryOptions: entryOptionsFromCandidates(candidates),
    entrySelectorType: candidates.some((candidate) => candidate.kind === "foundry_project") ? "workspace" : "source",
    onEntrySelect: async (option) => {
      return await prepareEntrySession(input.ensureDevArtifact, candidates, option.name);
    },
    onFunctionInputSubmit: input.onFunctionInputSubmit,
    onConfirmedTxPreview: input.onConfirmedTxPreview,
    onStateSnapshotRequest: input.onStateSnapshotRequest,
    onStateKeyBookChange: input.onStateKeyBookChange,
    onTransactionsRequest: input.onTransactionsRequest,
    onDeployedContractsRequest: input.onDeployedContractsRequest,
    onEventRecordsRequest: input.onEventRecordsRequest,
    onSourcePreviewsRequest: input.onSourcePreviewsRequest,
    onBuildRequest: input.onBuildRequest,
    onAccountStatusRequest: input.onAccountStatusRequest,
    onBlockWatchStart: input.onBlockWatchStart,
    onSettingsChange: input.onSettingsChange,
    ...(input.copyToSystemClipboard === undefined ? {} : { copyToSystemClipboard: input.copyToSystemClipboard }),
    onSourceFileSelect: createSourceFileSelectHandler(input),
  };
}

function entryOptionsFromCandidates(candidates: readonly DevWorkspaceCandidate[]): NonNullable<RunDevShellInput["entryOptions"]> {
  if (candidates.some((candidate) => candidate.kind === "foundry_project")) {
    return candidates.map((candidate, index) => ({
      name: String(index),
      label: candidate.kind === "foundry_project" ? candidate.label : sourceFileFromTarget(candidate.target),
      active: false,
      ...(candidate.kind === "foundry_project" ? { badge: "WORKSPACE" } : {}),
      meta: candidate.kind === "foundry_project" ? candidate.projectRoot : candidate.contract,
      description: candidate.kind === "foundry_project" ? candidate.projectRoot : candidate.target,
      previewLines: candidate.kind === "foundry_project" ? [candidate.label, candidate.projectRoot] : sourcePreviewLinesForCandidate(candidate),
      searchText: `${candidate.label} ${candidate.kind === "foundry_project" ? candidate.projectRoot : candidate.target}`,
    }));
  }

  const groups = new Map<string, { firstIndex: number; preferredIndex: number; contracts: string[]; targets: string[]; previewLines: readonly string[] }>();
  candidates.forEach((candidate, index) => {
    if (candidate.kind !== "standalone_contract") {
      return;
    }

    const sourceFile = sourceFileFromTarget(candidate.target);
    const current = groups.get(sourceFile);
    if (current === undefined) {
      groups.set(sourceFile, {
        firstIndex: index,
        preferredIndex: index,
        contracts: [candidate.contract],
        targets: [candidate.target],
        previewLines: sourcePreviewLinesForCandidate(candidate),
      });
      return;
    }

    if (candidate.deployable !== false && standaloneCandidateDeployable(candidates[current.preferredIndex]) === false) {
      current.preferredIndex = index;
    }
    current.contracts.push(candidate.contract);
    current.targets.push(candidate.target);
  });

  return [...groups.entries()].map(([sourceFile, group]) => ({
    name: String(group.preferredIndex),
    label: sourceFile,
    active: false,
    meta: group.contracts.length === 1 ? group.contracts[0] ?? "" : `${group.contracts.length} contracts`,
    description: group.contracts.length === 1 ? "" : group.contracts.join(", "),
    previewLines: group.previewLines,
    searchText: `${sourceFile} ${group.contracts.join(" ")} ${group.targets.join(" ")}`,
  }));
}

function standaloneCandidateDeployable(candidate: DevWorkspaceCandidate | undefined): boolean | undefined {
  return candidate?.kind === "standalone_contract" ? candidate.deployable : undefined;
}

export function createSourceFileSelectHandler(input: DevSourceFileSelectInput): NonNullable<RunDevShellInput["onSourceFileSelect"]> {
  return async ({ sourceFile, target, session: activeSession }) => {
    const workspaceRoot = activeSession.workspaceRoot ?? (activeSession.sourceMode === "single_file" ? input.cwd : undefined);
    const candidateTargets = sourceSelectionCandidateTargets({
      sourceFile,
      target,
      activeSession,
      workspaceRoot,
    });
    let lastError: unknown;
    for (const candidateTarget of candidateTargets) {
      try {
        const preparedSelection = resolveDevSession({
          cwd: workspaceRoot ?? input.cwd,
          target: candidateTarget,
          ...(activeSession.sourceMode === "project" ? { projectRoot: activeSession.projectRoot } : {}),
        });
        await input.ensureDevArtifact(preparedSelection);
        const nextSession = createDevSessionFromResolved(preparedSelection);
        return workspaceRoot === undefined
          ? nextSession
          : withWorkspaceSourceTargets(nextSession, workspaceRoot, activeSession.sourceTargets);
      } catch (error) {
        lastError = error;
        if (!shouldTryNextStandaloneCandidate(error)) {
          break;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };
}

function shouldOpenEntryPicker(candidates: readonly DevWorkspaceCandidate[]): boolean {
  return candidates.some((candidate) => candidate.kind === "foundry_project") || candidates.length > 1;
}

async function prepareEntrySession(
  ensureDevArtifact: (prepared: ResolvedDevSession) => Promise<void>,
  candidates: readonly DevWorkspaceCandidate[],
  optionName: string,
): Promise<DevSession> {
  const candidate = candidates[Number.parseInt(optionName, 10)];
  if (candidate === undefined) {
    throw new ProjectError({
      code: "dev_entry_candidate_not_found",
      message: "The selected dev entry no longer exists.",
      hint: "Close the picker and launch dev again.",
    });
  }

  if (candidate.kind === "foundry_project") {
    const prepared = resolveDevSession({ cwd: candidate.projectRoot, target: "" });
    await ensureDevArtifact(prepared);
    return createDevSessionFromResolved(prepared);
  }

  return await prepareStandaloneEntrySession(ensureDevArtifact, candidates, candidate);
}

async function prepareStandaloneEntrySession(
  ensureDevArtifact: (prepared: ResolvedDevSession) => Promise<void>,
  candidates: readonly DevWorkspaceCandidate[],
  candidate: Extract<DevWorkspaceCandidate, { readonly kind: "standalone_contract" }>,
): Promise<DevSession> {
  const sourceFile = sourceFileFromTarget(candidate.target);
  const sourceCandidates = candidates.filter(
    (entry): entry is Extract<DevWorkspaceCandidate, { readonly kind: "standalone_contract" }> =>
      entry.kind === "standalone_contract" && sourceFileFromTarget(entry.target) === sourceFile,
  );
  const orderedCandidates = [candidate, ...sourceCandidates.filter((entry) => entry.target !== candidate.target)];
  let lastError: unknown;
  for (const entry of orderedCandidates) {
    try {
      const prepared = resolveDevSession({ cwd: entry.workspaceRoot, target: entry.target });
      await ensureDevArtifact(prepared);
      const session = createDevSessionFromResolved(prepared);
      return withWorkspaceSourceTargets(session, entry.workspaceRoot, standaloneSourceTargets(candidates));
    } catch (error) {
      lastError = error;
      if (!shouldTryNextStandaloneCandidate(error)) {
        break;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function shouldTryNextStandaloneCandidate(error: unknown): boolean {
  return error instanceof ProjectError && [
    "artifact_not_found",
    "target_ambiguous",
    "dev_entry_candidate_not_found",
    "source_file_not_found",
  ].includes(error.code);
}

function sourceSelectionCandidateTargets(input: {
  readonly sourceFile: string;
  readonly target: string;
  readonly activeSession: DevSession;
  readonly workspaceRoot: string | undefined;
}): readonly string[] {
  const baseTargets = [
    input.target,
    ...input.activeSession.sourceTargets
      .filter((sourceTarget) => sourceTarget.sourceFile === input.sourceFile && sourceTarget.target !== input.target)
      .map((sourceTarget) => sourceTarget.target),
  ];
  return uniqueStrings(baseTargets.flatMap((target) => [
    target,
    ...singleFileWorkspaceTargets(target, input.activeSession, input.workspaceRoot),
  ]));
}

function singleFileWorkspaceTargets(
  target: string,
  activeSession: DevSession,
  workspaceRoot: string | undefined,
): readonly string[] {
  if (activeSession.sourceMode !== "single_file" || workspaceRoot === undefined) {
    return [];
  }

  const sourceFile = sourceFileFromTarget(target);
  if (!sourceFile.startsWith("src/")) {
    return [];
  }

  const workspaceSource = sourceFile.slice("src/".length);
  if (!existsSync(join(workspaceRoot, workspaceSource))) {
    return [];
  }

  const contract = contractFromTarget(target);
  return [contract === undefined || contract.length === 0 ? workspaceSource : `${workspaceSource}:${contract}`];
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function withWorkspaceSourceTargets(
  session: DevSession,
  workspaceRoot: string,
  sourceTargets: readonly DevSourceTarget[],
): DevSession {
  const sourceFiles = [...new Set(sourceTargets.map((target) => target.sourceFile))];
  return { ...session, workspaceRoot, sourceFiles, sourceTargets };
}

function standaloneSourceTargets(candidates: readonly DevWorkspaceCandidate[]): readonly DevSourceTarget[] {
  return candidates.flatMap((candidate) =>
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

function sourceFileFromTarget(target: string): string {
  return target.split(":")[0] ?? target;
}

function contractFromTarget(target: string): string | undefined {
  const separator = target.indexOf(":");
  return separator < 0 ? undefined : target.slice(separator + 1);
}
