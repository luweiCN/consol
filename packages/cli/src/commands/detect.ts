import {
  activeAccountMeta,
  activeNetworkMeta,
  findFoundryProjectRoot,
  resolveTarget,
} from "@consol/core";
import { detectFoundryTools, type FoundryToolsStatus } from "@consol/foundry";
import { createSuccessEnvelope, type AccountMeta, type NetworkMeta } from "@consol/protocol";
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";

export type DetectData = {
  readonly source_mode: "project" | "single_file";
  readonly target: string | null;
  readonly project_root: string | null;
  readonly foundry_toml: string | null;
  readonly artifact_dir: string | null;
  readonly scratch_project: string | null;
  readonly tools: FoundryToolsStatus;
  readonly network: NetworkMeta;
  readonly account: AccountMeta;
};

export type RunDetectCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
};

export async function runDetectCommand(input: RunDetectCommandInput): Promise<CliResult> {
  const target = detectTarget(input.commandArgs);
  const data = await createDetectData({
    cwd: input.cwd,
    env: input.env,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
    ...(target === undefined ? {} : { target }),
  });

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "detect",
        ...(data.project_root === null ? {} : { project_root: data.project_root }),
        network: data.network,
        account: data.account,
      },
    });

    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return {
    exitCode: 0,
    stdout: [
      "ConSol project detection",
      `  source mode: ${data.source_mode}`,
      `  project root: ${data.project_root ?? "not found"}`,
      `  foundry.toml: ${data.foundry_toml ?? "not found"}`,
      `  artifact dir: ${data.artifact_dir ?? "not found"}`,
      "",
    ].join("\n"),
    stderr: "",
  };
}

async function createDetectData(input: {
  readonly cwd: string;
  readonly env: CliEnv;
  readonly projectRoot?: string;
  readonly target?: string;
}): Promise<DetectData> {
  const foundryToml = findFoundryProjectRoot(searchStart(input))?.foundryToml ?? null;
  const projectRoot = input.projectRoot === undefined ? projectRootFromFoundryToml(foundryToml) : realpathSync(input.projectRoot);
  const targetResolution = input.target?.includes(".sol")
    ? resolveTarget({
        cwd: input.cwd,
        target: input.target,
        ...(input.projectRoot === undefined ? {} : { projectRoot: input.projectRoot }),
      })
    : null;
  const sourceMode = targetResolution?.sourceMode ?? "project";
  const network = activeNetworkMeta(input.env);
  const account = activeAccountMeta(input.env);

  return {
    source_mode: sourceMode,
    target: input.target ?? null,
    project_root: projectRoot,
    foundry_toml: foundryToml,
    artifact_dir: projectRoot === null ? null : join(projectRoot, "out"),
    scratch_project: sourceMode === "single_file" ? targetResolution?.projectRoot ?? null : null,
    tools: await detectFoundryTools({ cwd: input.cwd, env: input.env }),
    network,
    account,
  };
}

function detectTarget(commandArgs: readonly string[]): string | undefined {
  return commandArgs.find((arg) => arg !== "--json");
}

function searchStart(input: { readonly cwd: string; readonly projectRoot?: string; readonly target?: string }): string {
  if (input.projectRoot !== undefined) {
    return input.projectRoot;
  }

  if (input.target !== undefined) {
    const file = input.target.split(":")[0];
    if (file !== undefined) {
      const path = isAbsolute(file) ? file : resolve(input.cwd, file);
      if (existsSync(path)) {
        return dirname(path);
      }
    }
  }

  return input.cwd;
}

function projectRootFromFoundryToml(foundryToml: string | null): string | null {
  return foundryToml === null ? null : dirname(foundryToml);
}
