import { activeAccountMeta, findFoundryProjectRoot } from "@consol/core";
import { createSuccessEnvelope } from "@consol/protocol";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import { resolveCliNetworkRuntime } from "./network-runtime";

export type RunSnapshotCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
};

export function runSnapshotCommand(input: RunSnapshotCommandInput): CliResult {
  const projectRoot = input.globals.project === undefined ? findFoundryProjectRoot(input.cwd)?.projectRoot ?? null : realpathSync(input.globals.project);
  const network = resolveCliNetworkRuntime({ globals: input.globals, env: input.env }).meta;
  const account = activeAccountMeta(input.env);
  const data = {
    source_mode: "project",
    project_root: projectRoot,
    network,
    account,
    contracts: [],
    deployments: [],
    diagnostics: [],
    recent_history: projectRoot === null ? [] : recentHistory(projectRoot, 5),
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "snapshot",
        ...(projectRoot === null ? {} : { project_root: projectRoot }),
        network,
        account,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: "ConSol snapshot\n", stderr: "" };
}

function recentHistory(projectRoot: string, limit: number): readonly unknown[] {
  const path = join(projectRoot, ".consol", "transactions.json");
  if (!existsSync(path)) {
    return [];
  }

  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const entries = getArrayProperty(raw, "entries");
  return entries.slice(-limit);
}

function getArrayProperty(raw: unknown, key: string): readonly unknown[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return [];
  }

  const value = (raw as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}
