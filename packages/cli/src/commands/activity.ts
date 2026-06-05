import { activeAccountMeta, resolveTarget, type ResolvedTarget } from "@consol/core";
import { createSuccessEnvelope } from "@consol/protocol";
import type { AccountMeta, NetworkMeta } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import {
  activityStatus,
  envelopeData,
  latestDeployment,
  parseActivityOptions,
  recentEntries,
  type ActivityStatus,
} from "./activity-data";
import { runStateCommand, type StateData } from "./interact";
import { runLogsCommand, type LogsData } from "./logs";
import { resolveCliNetworkRuntime } from "./network-runtime";

export type RunActivityCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
  readonly ensureArtifact?: (resolved: ResolvedTarget) => Promise<void>;
};

export async function runActivityCommand(input: RunActivityCommandInput): Promise<CliResult> {
  const options = parseActivityOptions(input.commandArgs);
  const resolved = resolveTarget({
    cwd: input.cwd,
    target: options.target,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  const network = resolveCliNetworkRuntime({ globals: input.globals, env: input.env }).meta;
  const account = activeAccountMeta(input.env);
  const deployment = options.address === undefined ? latestDeployment({
    projectRoot: resolved.projectRoot,
    contract: resolved.contractName,
    networkFingerprint: network.fingerprint ?? network.name,
    deployer: account.address ?? account.name,
  }) : null;
  const transactions = recentEntries(resolved.projectRoot, options.limit, resolved.contractName);
  const selectedAddress = options.address ?? deployment?.address ?? null;

  if (selectedAddress === null) {
    const status = activityStatus({
      status: "deployment_not_found",
      message: `No deployment found for ${resolved.contractName} on ${network.name}.`,
      hint: "Run `consol deploy <target>` first.",
    });
    const data = {
      target: options.target,
      contract: resolved.contractName,
      project_root: resolved.projectRoot,
      network,
      account,
      deployment: {
        status,
        address: null,
        entry: null,
      },
      state: {
        status,
        address: null,
        values: [],
      },
      logs: {
        status,
        address: null,
        events: [],
      },
      transactions,
    };

    return activityResult(input, data);
  }

  const state = await activityState(input, options.target, options.address);
  const logs = await activityLogs(input, options.target, options.address);
  const data = {
    target: options.target,
    contract: resolved.contractName,
    project_root: resolved.projectRoot,
    network,
    account,
    deployment: {
      status: activityStatus({
        status: "ready",
        message: `${selectedAddress} is deployed.`,
        hint: null,
      }),
      address: selectedAddress,
      entry: deployment,
    },
    state,
    logs,
    transactions,
  };

  return activityResult(input, data);
}

function activityResult(
  input: RunActivityCommandInput,
  data: {
    readonly contract: string;
    readonly project_root: string;
    readonly network: NetworkMeta;
    readonly account: AccountMeta;
  } & Record<string, unknown>,
): CliResult {
  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "activity",
        project_root: data.project_root,
        network: data.network,
        account: data.account,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `Activity ${data.contract}\n`, stderr: "" };
}

async function activityState(
  input: RunActivityCommandInput,
  target: string,
  address: string | undefined,
): Promise<{
  readonly status: ActivityStatus;
  readonly address: string | null;
  readonly values: StateData["values"];
}> {
  const result = await runStateCommand({
    globals: { ...input.globals, json: true },
    commandArgs: [target, ...(address === undefined ? [] : ["--address", address]), "--json"],
    cwd: input.cwd,
    env: input.env,
    ...(input.ensureArtifact === undefined ? {} : { ensureArtifact: input.ensureArtifact }),
  });
  if (result.exitCode !== 0) {
    return {
      status: activityStatus({
        status: "state_failed",
        message: result.stderr.trim() || "State snapshot failed.",
        hint: null,
      }),
      address: null,
      values: [],
    };
  }

  const data = envelopeData<StateData>(result.stdout);
  return {
    status: activityStatus({
      status: "ready",
      message: stateMessage(data.values),
      hint: null,
    }),
    address: data.address,
    values: data.values,
  };
}

function stateMessage(values: StateData["values"]): string {
  if (values.length === 0) {
    return "No zero-argument read functions found.";
  }

  const failed = values.filter((value) => typeof value.error === "string" && value.error.length > 0).length;
  if (failed === 0) {
    return `${values.length} reader value(s) loaded.`;
  }

  return `${values.length - failed}/${values.length} reader value(s) loaded; ${failed} failed.`;
}

async function activityLogs(
  input: RunActivityCommandInput,
  target: string,
  address: string | undefined,
): Promise<{
  readonly status: ActivityStatus;
  readonly address: string | null;
  readonly events: LogsData["events"];
}> {
  const result = await runLogsCommand({
    globals: { ...input.globals, json: true },
    commandArgs: [target, ...(address === undefined ? [] : ["--address", address]), "--json"],
    cwd: input.cwd,
    env: input.env,
    ...(input.ensureArtifact === undefined ? {} : { ensureArtifact: input.ensureArtifact }),
  });
  if (result.exitCode !== 0) {
    return {
      status: activityStatus({
        status: "logs_failed",
        message: result.stderr.trim() || "Logs snapshot failed.",
        hint: null,
      }),
      address: null,
      events: [],
    };
  }

  const data = envelopeData<LogsData>(result.stdout);
  return {
    status: activityStatus({
      status: "ready",
      message: data.events.length === 0 ? "No logs found for this deployment." : `${data.events.length} decoded event(s) loaded.`,
      hint: null,
    }),
    address: data.address,
    events: data.events,
  };
}
