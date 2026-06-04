import { defaultAccountMeta, defaultNetworkMeta, discoverDeployPlan, ProjectError, resolveTarget } from "@consol/core";
import type { DeployPlanItem } from "@consol/core";
import { runForgeBuild } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import type { CliResult } from "../main";
import { VERSION } from "../version";
import { executeDeployment, type DeployData, type RunDeployCommandInput } from "./deploy-execute";

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
  const network = defaultNetworkMeta();
  const account = defaultAccountMeta();
  if (network.write_policy !== "local") {
    throw new ProjectError({
      code: "deploy_remote_not_supported",
      message: `Deploy is not enabled for ${network.name} yet.`,
      hint: "Use the local profile while the TS rewrite wires remote write confirmation.",
    });
  }

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
    network: network.name,
    chain_id: network.chain_id,
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
        network,
        account,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return {
    exitCode: 0,
    stdout: `deploy --all\n  project: ${data.project_root}\n  network: ${data.network}\n`,
    stderr: "",
  };
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
