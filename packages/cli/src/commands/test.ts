import { resolveTarget } from "@consol/core";
import { runForgeTest } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";

export type TestData = {
  readonly project_root: string;
  readonly status: "success" | "failed";
  readonly stdout: string;
  readonly stderr: string;
};

export type RunTestCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
};

export async function runTestCommand(input: RunTestCommandInput): Promise<CliResult> {
  const resolved = resolveTarget({
    cwd: input.cwd,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  const result = await runForgeTest({
    cwd: resolved.projectRoot,
    projectRoot: resolved.projectRoot,
    env: input.env,
  });
  const data: TestData = {
    project_root: resolved.projectRoot,
    status: result.ok ? "success" : "failed",
    stdout: result.stdout,
    stderr: result.stderr,
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "test",
        project_root: data.project_root,
      },
    });
    return { exitCode: data.status === "success" ? 0 : 1, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  if (data.status === "success") {
    return { exitCode: 0, stdout: `Tests passed: ${data.project_root}\n${data.stdout}`, stderr: "" };
  }

  return { exitCode: 1, stdout: "", stderr: "Foundry tests failed.\n" };
}
