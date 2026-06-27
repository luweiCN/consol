import { discoverDeployPlan, ProjectError, resolveTarget } from "@consol/core";
import type { DeployPlanItem } from "@consol/core";
import { runForgeBuild } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import type { CliResult } from "../main";
import { VERSION } from "../version";
import { executeDeployment, type DeployData, type RunDeployCommandInput } from "./deploy-execute";
import { resolveCliWriteNetworkRuntime } from "./network-runtime";
import { resolveWriteSigner } from "./write-signer";

export type DeployAllData = {
  readonly project_root: string;
  readonly network: string;
  readonly chain_id: number | null;
  readonly plan: readonly DeployPlanItem[];
  readonly results: readonly DeployAllResult[];
};

export type DeployAllResult = {
  readonly target: string;
  readonly contract: string;
  readonly status: "deployed" | "cached" | "skipped" | "failed";
  readonly deployment: DeployData | null;
  readonly error: string | null;
};

export async function runDeployAllCommand(input: RunDeployCommandInput): Promise<CliResult> {
  const resolved = resolveTarget({
    cwd: input.cwd,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  const projectRoot = resolved.projectRoot;
  const network = await resolveCliWriteNetworkRuntime({ globals: input.globals, cwd: projectRoot, env: input.env });
  const account = resolveWriteSigner({ globals: input.globals, env: input.env }).account;

  const build = await runForgeBuild({
    cwd: projectRoot,
    projectRoot,
    env: input.env,
  });
  if (!build.ok) {
    throw new ProjectError({
      code: "foundry_build_failed",
      message: "Foundry build failed before deploy.",
      hint: build.stderr.trim() || build.stdout.trim() || build.error,
    });
  }

  const plan = discoverDeployPlan(projectRoot);
  const results = await deployPlanItems(input, plan);
  const data: DeployAllData = {
    project_root: projectRoot,
    network: network.meta.name,
    chain_id: network.meta.chain_id,
    plan,
    results,
  };

  if (input.globals.ndjson) {
    return { exitCode: 0, stdout: "", stderr: "" };
  }
  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "deploy --all",
        network: network.meta,
        account,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return {
    exitCode: 0,
    stdout: deployAllHuman(data),
    stderr: "",
  };
}

function deployAllHuman(data: DeployAllData): string {
  const lines = [
    "deploy --all",
    `  project: ${data.project_root}`,
    `  network: ${data.network}${data.chain_id === null ? "" : ` #${data.chain_id}`}`,
    "  results:",
  ];
  if (data.results.length === 0) {
    lines.push("    (none)");
    return `${lines.join("\n")}\n`;
  }

  for (const result of data.results) {
    const detail =
      result.deployment === null
        ? result.error === null
          ? ""
          : `: ${result.error}`
        : ` -> ${result.deployment.address}${result.deployment.tx_hash === null ? "" : ` tx ${result.deployment.tx_hash}`}`;
    lines.push(`    ${result.status} ${result.contract}${detail}`);
  }
  return `${lines.join("\n")}\n`;
}

async function deployPlanItems(
  input: RunDeployCommandInput,
  plan: readonly DeployPlanItem[],
): Promise<readonly DeployAllResult[]> {
  const results: DeployAllResult[] = [];
  for (const item of plan) {
    if (!item.deployable) {
      results.push(planResult(item, "skipped", null, item.reason));
      continue;
    }

    try {
      const { data } = await executeDeployment(input, {
        target: item.target,
        constructorArgs: [],
        fresh: false,
        skipBuild: true,
        libraries: [],
      });
      results.push(planResult(item, data.cached ? "cached" : "deployed", data, null));
    } catch (error) {
      results.push(planResult(item, "failed", null, deployError(error)));
    }
  }
  return results;
}

function planResult(
  item: DeployPlanItem,
  status: DeployAllResult["status"],
  deployment: DeployData | null,
  error: string | null,
): DeployAllResult {
  return {
    target: item.target,
    contract: item.contract,
    status,
    deployment,
    error,
  };
}

function deployError(error: unknown): string {
  if (error instanceof ProjectError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
