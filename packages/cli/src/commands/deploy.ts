import { resolveTarget } from "@consol/core";
import { createSuccessEnvelope } from "@consol/protocol";
import type { CliResult } from "../main";
import { VERSION } from "../version";
import { runDeployAllCommand } from "./deploy-all";
import {
  contractNameFromTarget,
  deploymentEntries,
  deploymentEntry,
  readDeploymentCache,
  writeDeploymentCache,
} from "./deploy-cache";
import type { DeployListItem } from "./deploy-cache";
import { deployLifecycleNdjson } from "./deploy-ndjson";
import { forgetTargetArg, parseDeployOptions } from "./deploy-options";
import { executeDeployment, type RunDeployCommandInput } from "./deploy-execute";

export type { DeployListItem } from "./deploy-cache";
export type { DeployData, RunDeployCommandInput } from "./deploy-execute";

export type DeployListData = {
  readonly project_root: string;
  readonly deployments: readonly DeployListItem[];
};

export type DeployForgetData = {
  readonly project_root: string;
  readonly target: string;
  readonly removed: number;
};

export async function runDeployCommand(input: RunDeployCommandInput): Promise<CliResult> {
  if (input.commandArgs.includes("--all")) {
    return await runDeployAllCommand(input);
  }

  const forgetTarget = forgetTargetArg(input.commandArgs);
  if (forgetTarget !== undefined) {
    return forgetDeployment(input, forgetTarget);
  }

  if (input.commandArgs.includes("--list")) {
    return listDeployments(input);
  }

  const options = parseDeployOptions(input.commandArgs);
  const { data, network, account } = await executeDeployment(input, options);
  if (input.globals.ndjson) {
    return {
      exitCode: 0,
      stdout: deployLifecycleNdjson({
        data,
        target: options.target,
        network,
        account,
      }),
      stderr: "",
    };
  }
  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "deploy",
        network,
        account,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return {
    exitCode: 0,
    stdout: `${data.contract} deployed at ${data.address}${data.cached ? " (cached)" : ""}\n`,
    stderr: "",
  };
}

function listDeployments(input: RunDeployCommandInput): CliResult {
  const resolved = resolveTarget({
    cwd: input.cwd,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  const data: DeployListData = {
    project_root: resolved.projectRoot,
    deployments: deploymentEntries(resolved.projectRoot).sort((left, right) =>
      right.deployed_at_unix - left.deployed_at_unix || left.contract.localeCompare(right.contract),
    ),
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "deploy --list",
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `deployments\n  project: ${data.project_root}\n`, stderr: "" };
}

function forgetDeployment(input: RunDeployCommandInput, target: string): CliResult {
  const resolved = resolveTarget({
    cwd: input.cwd,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  const cache = readDeploymentCache(resolved.projectRoot);
  const before = Object.keys(cache.entries).length;
  const contract = contractNameFromTarget(target);
  const entries = Object.fromEntries(
    Object.entries(cache.entries).filter(([, value]) => {
      const item = deploymentEntry(value);
      return item === null || item.contract !== contract;
    }),
  );
  const next = {
    version: cache.version,
    entries,
  };
  writeDeploymentCache(resolved.projectRoot, next);
  const data: DeployForgetData = {
    project_root: resolved.projectRoot,
    target,
    removed: before - Object.keys(entries).length,
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "deploy --forget",
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `forgot ${data.removed} deployment entries for ${target}\n`, stderr: "" };
}
