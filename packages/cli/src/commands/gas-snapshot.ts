import { ProjectError, resolveTarget } from "@consol/core";
import { runForgeGasSnapshot } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import type { CliResult } from "../main";
import { VERSION } from "../version";
import type { RunGasCommandInput } from "./gas";

export type GasSnapshotData = {
  readonly project_root: string;
  readonly diff: boolean;
  readonly check: boolean;
  readonly status: "success" | "failed";
  readonly stdout: string;
  readonly stderr: string;
};

type GasSnapshotOptions = {
  readonly diff: boolean;
  readonly check: boolean;
};

export async function runGasSnapshotCommand(input: RunGasCommandInput): Promise<CliResult> {
  const options = parseGasSnapshotOptions(input.commandArgs);
  const resolved = resolveTarget({
    cwd: input.cwd,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  const snapshot = await runForgeGasSnapshot({
    cwd: resolved.projectRoot,
    projectRoot: resolved.projectRoot,
    env: input.env,
    diff: options.diff,
    check: options.check,
  });
  const data: GasSnapshotData = {
    project_root: resolved.projectRoot,
    diff: options.diff,
    check: options.check,
    status: snapshot.ok ? "success" : "failed",
    stdout: snapshot.stdout,
    stderr: snapshot.stderr,
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "gas snapshot",
        project_root: resolved.projectRoot,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: snapshot.ok ? 0 : 1, stdout: snapshot.stdout, stderr: snapshot.stderr };
}

function parseGasSnapshotOptions(commandArgs: readonly string[]): GasSnapshotOptions {
  let diff = false;
  let check = false;

  for (let index = 1; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (arg === undefined || arg === "--json") {
      continue;
    }
    if (arg === "--diff") {
      diff = true;
      continue;
    }
    if (arg === "--check") {
      check = true;
      continue;
    }

    throw new ProjectError({
      code: "gas_snapshot_arg_unsupported",
      message: `Unsupported gas snapshot argument: ${arg}`,
      hint: "Use `consol gas snapshot [--diff|--check]`.",
    });
  }

  if (diff && check) {
    throw new ProjectError({
      code: "gas_snapshot_mode_conflict",
      message: "`gas snapshot` accepts only one of `--diff` or `--check`.",
      hint: "Run either `consol gas snapshot --diff` or `consol gas snapshot --check`.",
    });
  }

  return { diff, check };
}
