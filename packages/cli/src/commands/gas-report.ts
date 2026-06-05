import { ProjectError, resolveTarget } from "@consol/core";
import { runForgeGasReport } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import type { CliResult } from "../main";
import { VERSION } from "../version";
import type { RunGasCommandInput } from "./gas";

export type GasReportData = {
  readonly project_root: string;
  readonly match_contract: string | null;
  readonly status: "success" | "failed";
  readonly stdout: string;
  readonly stderr: string;
};

type GasReportOptions = {
  readonly matchContract?: string;
};

export async function runGasReportCommand(input: RunGasCommandInput): Promise<CliResult> {
  const options = parseGasReportOptions(input.commandArgs);
  const resolved = resolveTarget({
    cwd: input.cwd,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  const report = await runForgeGasReport({
    cwd: resolved.projectRoot,
    projectRoot: resolved.projectRoot,
    env: input.env,
    ...(options.matchContract === undefined ? {} : { matchContract: options.matchContract }),
  });
  const data: GasReportData = {
    project_root: resolved.projectRoot,
    match_contract: options.matchContract ?? null,
    status: report.ok ? "success" : "failed",
    stdout: report.stdout,
    stderr: report.stderr,
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "gas report",
        project_root: resolved.projectRoot,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: report.ok ? 0 : 1, stdout: report.stdout, stderr: report.stderr };
}

function parseGasReportOptions(commandArgs: readonly string[]): GasReportOptions {
  let matchContract: string | undefined;

  for (let index = 1; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (arg === undefined || arg === "--json") {
      continue;
    }
    if (arg === "--match-contract") {
      const value = commandArgs[index + 1];
      if (value === undefined) {
        throw new ProjectError({
          code: "missing_flag_value",
          message: "Missing value for --match-contract.",
          hint: "Pass a contract name after --match-contract.",
        });
      }
      matchContract = value;
      index += 1;
      continue;
    }

    throw new ProjectError({
      code: "gas_report_arg_unsupported",
      message: `Unsupported gas report argument: ${arg}`,
      hint: "Use `consol gas report [--match-contract <name>]`.",
    });
  }

  return matchContract === undefined ? {} : { matchContract };
}
