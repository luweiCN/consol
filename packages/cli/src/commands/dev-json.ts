import {
  activeAccountMeta,
  type DevSession,
  type ResolvedTarget,
} from "@consol/core";
import type { AccountMeta, NetworkMeta } from "@consol/protocol";
import { join } from "node:path";
import type { GlobalArgs } from "../args";
import type { CliEnv } from "../main";
import { runActivityCommand } from "./activity";
import { devSessionActionContext } from "./dev-session-context";
import { resolveCliNetworkRuntime } from "./network-runtime";

export type DevJsonSnapshot = {
  readonly data: Record<string, unknown>;
  readonly network: NetworkMeta;
  readonly account: AccountMeta;
};

type CreateDevJsonSnapshotInput = {
  readonly globals: GlobalArgs;
  readonly cwd: string;
  readonly env: CliEnv;
  readonly session: DevSession;
  readonly targetOverride?: string;
  readonly addressOverride?: string;
  readonly ensureArtifact?: (resolved: ResolvedTarget) => Promise<void>;
};

type DevActivitySnapshot = {
  readonly data: Record<string, unknown>;
  readonly deployment: unknown;
  readonly state: unknown;
  readonly events: unknown;
  readonly transactions: readonly unknown[];
};

export async function createDevJsonSnapshot(input: CreateDevJsonSnapshotInput): Promise<DevJsonSnapshot> {
  const network = resolveCliNetworkRuntime({ globals: input.globals, env: input.env }).meta;
  const account = activeAccountMeta(input.env);
  const activity = await devActivitySnapshot(input);

  return {
    network,
    account,
    data: {
      target: input.session.target,
      contract: input.session.contract,
      source_mode: input.session.sourceMode,
      project_root: input.session.projectRoot,
      current_file: input.session.sourceFile,
      source_files: input.session.sourceFiles,
      source_targets: sourceTargetPayload(input.session),
      source_explorer: sourceExplorerPayload(input.session),
      artifact_path: input.session.artifactPath,
      abi_summary: input.session.abiSummary,
      functions: input.session.functions,
      network,
      account,
      deployment: activity.deployment,
      state: activity.state,
      events: activity.events,
      activity: activity.data,
      diagnostics: diagnosticsPanel(),
      feed: [],
      transactions: activity.transactions,
    },
  };
}

async function devActivitySnapshot(input: CreateDevJsonSnapshotInput): Promise<DevActivitySnapshot> {
  const fallback = devActivityFallback(input.session);
  const result = await runActivityCommand({
    globals: devActivityGlobals(input),
    commandArgs: [
      devActivityTarget(input),
      ...(input.addressOverride === undefined ? [] : ["--address", input.addressOverride]),
      "--json",
      "--limit",
      "10",
    ],
    cwd: devActivityCwd(input),
    env: input.env,
    ...(input.ensureArtifact === undefined ? {} : { ensureArtifact: input.ensureArtifact }),
  });
  if (result.exitCode !== 0) {
    return fallback;
  }

  const data = envelopeData(result.stdout);
  return {
    data,
    deployment: getRecordProperty(data, "deployment") ?? fallback.deployment,
    state: getRecordProperty(data, "state") ?? fallback.state,
    events: getRecordProperty(data, "logs") ?? fallback.events,
    transactions: getArrayProperty(data, "transactions"),
  };
}

function devActivityGlobals(input: CreateDevJsonSnapshotInput): GlobalArgs {
  return input.session.sourceMode === "single_file" && input.targetOverride === undefined
    ? { ...input.globals, json: true, project: input.session.projectRoot }
    : { ...input.globals, json: true };
}

function devActivityCwd(input: CreateDevJsonSnapshotInput): string {
  return input.targetOverride === undefined ? input.session.projectRoot : input.cwd;
}

function devActivityTarget(input: CreateDevJsonSnapshotInput): string {
  return input.targetOverride ?? devSessionActionContext(input.session).target;
}

function devActivityFallback(session: DevSession): DevActivitySnapshot {
  const status = {
    status: "activity_unavailable",
    message: `Activity snapshot is unavailable for ${session.contract}.`,
    hint: "Run `consol activity <target> --json` for details.",
  };
  const data = {
    target: session.target,
    contract: session.contract,
    project_root: session.projectRoot,
    deployment: {
      status,
      address: null,
      entry: null,
    },
    state: {
      status,
      address: null,
      values: [],
    },
    logs: {
      status,
      address: null,
      events: [],
    },
    transactions: [],
  };

  return {
    data,
    deployment: data.deployment,
    state: data.state,
    events: data.logs,
    transactions: data.transactions,
  };
}

function sourceTargetPayload(session: DevSession) {
  return session.sourceTargets.map((target) => ({
    source_file: target.sourceFile,
    contract: target.contract,
    target: target.target,
    ...(target.declarationKind === undefined ? {} : { declaration_kind: target.declarationKind }),
    ...(target.deployable === undefined ? {} : { deployable: target.deployable }),
    ...(target.deployReason === undefined ? {} : { deploy_reason: target.deployReason }),
  }));
}

function sourceExplorerPayload(session: DevSession) {
  return {
    status: sourceExplorerStatus(session),
    root: session.projectRoot,
    files: session.sourceFiles.map((sourceFile) => ({
      path: sourceFile,
      absolute_path: join(session.projectRoot, sourceFile),
      category: sourceCategory(sourceFile),
      contracts: session.sourceTargets
        .filter((target) => target.sourceFile === sourceFile)
        .map((target) => ({
          name: target.contract,
          kind: target.declarationKind ?? "contract",
          target: target.target,
          deployable: target.deployable ?? true,
          ...(target.deployReason === undefined ? {} : { deploy_reason: target.deployReason }),
        })),
    })),
  };
}

function sourceExplorerStatus(session: DevSession) {
  return session.sourceFiles.length === 0
    ? { status: "empty", message: "No Solidity files found.", hint: "Create a contract under src/ or pass an explicit target." }
    : { status: "ready", message: `${session.sourceFiles.length} files / ${session.sourceTargets.length} contracts`, hint: null };
}

function sourceCategory(sourceFile: string): string {
  const [category] = sourceFile.split("/");
  return category?.endsWith(".sol") ? "root" : category ?? "root";
}

function diagnosticsPanel() {
  return {
    status: {
      status: "not_run",
      message: "Build diagnostics have not been run in this dev session.",
      hint: "Run `consol build` to refresh compiler diagnostics.",
    },
    diagnostics: [],
    stdout: null,
    stderr: null,
  };
}

function envelopeData(stdout: string): Record<string, unknown> {
  const parsed = JSON.parse(stdout) as unknown;
  return getRecordProperty(parsed, "data") ?? {};
}

function getRecordProperty(raw: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }

  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function getArrayProperty(raw: unknown, key: string): readonly unknown[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return [];
  }

  const value = (raw as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}
