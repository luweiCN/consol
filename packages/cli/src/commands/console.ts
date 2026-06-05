import { activeAccountMeta, createDevSession } from "@consol/core";
import { createSuccessEnvelope } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import { resolveCliNetworkRuntime } from "./network-runtime";

export type RunConsoleCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
};

export function runConsoleCommand(input: RunConsoleCommandInput): CliResult {
  const target = commandTarget(input.commandArgs) ?? "";
  const session = createDevSession({
    cwd: input.cwd,
    target,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  const network = resolveCliNetworkRuntime({ globals: input.globals, env: input.env }).meta;
  const account = activeAccountMeta(input.env);
  const data = {
    target,
    contract: session.contract,
    source_mode: session.sourceMode,
    project_root: session.projectRoot,
    network,
    account,
    commands: ["state", "logs", "call", "send", "help", "exit"],
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "console",
        project_root: data.project_root,
        network,
        account,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `ConSol console: ${data.contract} on ${network.name} as ${account.name}\n`, stderr: "" };
}

function commandTarget(commandArgs: readonly string[]): string | undefined {
  return commandArgs.find((arg) => arg !== "--json");
}
