import { resolveTarget } from "@consol/core";
import { runForgeBuild } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import { parseBuildDiagnostics, type BuildDiagnostic } from "./diagnostics";

export type BuildData = {
  readonly target: string | null;
  readonly source_mode: "project" | "single_file";
  readonly project_root: string;
  readonly status: "success" | "failed";
  readonly diagnostics: readonly BuildDiagnostic[];
  readonly stdout: string;
  readonly stderr: string;
};

export type RunBuildCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
};

export async function runBuildCommand(input: RunBuildCommandInput): Promise<CliResult> {
  const target = commandTarget(input.commandArgs);
  const resolved = resolveTarget({
    cwd: input.cwd,
    ...(target === undefined ? {} : { target }),
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  const result = await runForgeBuild({
    cwd: resolved.projectRoot,
    projectRoot: resolved.projectRoot,
    env: input.env,
  });
  const data: BuildData = {
    target: target ?? null,
    source_mode: resolved.sourceMode,
    project_root: resolved.projectRoot,
    status: result.ok ? "success" : "failed",
    diagnostics: parseBuildDiagnostics(result.stdout, result.stderr),
    stdout: result.stdout,
    stderr: result.stderr,
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "build",
        project_root: data.project_root,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  if (data.status === "success") {
    return { exitCode: 0, stdout: `Build succeeded: ${data.project_root}\n`, stderr: "" };
  }

  return { exitCode: 1, stdout: "", stderr: "Foundry build failed.\n" };
}

function commandTarget(commandArgs: readonly string[]): string | undefined {
  return commandArgs.find((arg) => arg !== "--json");
}
