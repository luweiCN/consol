import { ProjectError, resolveTarget } from "@consol/core";
import { createSuccessEnvelope } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import { executeDeployment } from "./deploy-execute";

export type RunDemoCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
};

export type DemoData = {
  readonly target: string;
  readonly source_mode: "project" | "single_file";
  readonly project_root: string;
  readonly constructor_args: readonly string[];
  readonly contract: string;
  readonly address: string;
  readonly cached: boolean;
  readonly network: string;
  readonly chain_id: number | null;
  readonly next_commands: readonly string[];
};

export async function runDemoCommand(input: RunDemoCommandInput): Promise<CliResult> {
  const options = parseDemoOptions(input.commandArgs);
  const resolved = resolveTarget({
    cwd: input.cwd,
    target: options.target,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  const { data: deployment, network, account } = await executeDeployment(input, {
    target: options.target,
    constructorArgs: options.constructorArgs,
    fresh: false,
  });
  const data: DemoData = {
    target: options.target,
    source_mode: resolved.sourceMode,
    project_root: resolved.projectRoot,
    constructor_args: options.constructorArgs,
    contract: deployment.contract,
    address: deployment.address,
    cached: deployment.cached,
    network: deployment.network,
    chain_id: deployment.chain_id,
    next_commands: nextCommands(options.target),
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "demo",
        project_root: data.project_root,
        network,
        account,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `Demo ready: ${data.contract} at ${data.address}\n`, stderr: "" };
}

type DemoOptions = {
  readonly target: string;
  readonly constructorArgs: readonly string[];
};

function parseDemoOptions(commandArgs: readonly string[]): DemoOptions {
  const args = commandArgs.filter((arg) => arg !== "--json");
  const target = args[0];
  if (target === undefined) {
    throw new ProjectError({
      code: "demo_target_required",
      message: "Missing target for demo.",
      hint: "Use `consol demo <target> [constructor_args...]`.",
    });
  }

  return {
    target,
    constructorArgs: args.slice(1),
  };
}

function nextCommands(target: string): readonly string[] {
  return [
    `consol inspect ${target}`,
    `consol state ${target}`,
    `consol call ${target} <viewFunction>`,
    `consol send ${target} <function> <args...> --yes`,
  ];
}
