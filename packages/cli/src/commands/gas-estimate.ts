import { ProjectError } from "@consol/core";
import { runCastEstimate } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import type { CliResult } from "../main";
import { VERSION } from "../version";
import type { RunGasCommandInput } from "./gas";
import { createReadContext } from "./interact-context";
import { resolveFunctionSignature } from "./interact";

export type GasEstimateData = {
  readonly target: string;
  readonly contract: string;
  readonly address: string;
  readonly function: string;
  readonly signature: string;
  readonly args: readonly string[];
  readonly value: string | null;
  readonly from: string | null;
  readonly gas: string;
  readonly signal: {
    readonly kind: "rpc_estimate";
    readonly source: "cast estimate";
    readonly confidence: "medium";
    readonly context: {
      readonly target: string;
      readonly contract: string;
      readonly address: string;
      readonly function: string;
      readonly network: string;
      readonly chain_id: number | null;
      readonly from?: string;
      readonly value?: string;
    };
    readonly estimate: string;
    readonly error: null;
  };
};

type GasEstimateOptions = {
  readonly target: string;
  readonly functionName: string;
  readonly args: readonly string[];
  readonly value?: string;
};

export async function runGasEstimateCommand(input: RunGasCommandInput): Promise<CliResult> {
  const options = parseGasEstimateOptions(input.commandArgs);
  const context = await createReadContext({
    globals: input.globals,
    cwd: input.cwd,
    env: input.env,
    target: options.target,
  });
  const signature = resolveFunctionSignature(context.artifact.abi, options.functionName, true);
  const estimate = await runCastEstimate({
    cwd: context.resolved.projectRoot,
    env: input.env,
    rpcUrl: context.rpc_url,
    address: context.address,
    signature,
    args: options.args,
    ...(context.account.address === null ? {} : { from: context.account.address }),
    ...(options.value === undefined ? {} : { value: options.value }),
  });
  if (!estimate.ok) {
    throw new ProjectError({
      code: "gas_estimate_failed",
      message: `cast estimate failed for ${signature}.`,
      hint: estimate.stderr.trim() || estimate.stdout.trim() || estimate.error,
    });
  }

  const gas = estimate.stdout.trim();
  const data: GasEstimateData = {
    target: options.target,
    contract: context.resolved.contractName,
    address: context.address,
    function: options.functionName,
    signature,
    args: options.args,
    value: options.value ?? null,
    from: context.account.address,
    gas,
    signal: {
      kind: "rpc_estimate",
      source: "cast estimate",
      confidence: "medium",
      context: estimateContext({
        target: options.target,
        contract: context.resolved.contractName,
        address: context.address,
        functionName: signature,
        network: context.network.name,
        chainId: context.network.chain_id,
        from: context.account.address,
        ...(options.value === undefined ? {} : { value: options.value }),
      }),
      estimate: gas,
      error: null,
    },
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "gas estimate",
        project_root: context.resolved.projectRoot,
        network: context.network,
        account: context.account,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `Gas estimate: ${data.contract} ${data.signature} -> ${data.gas}\n`, stderr: "" };
}

function parseGasEstimateOptions(commandArgs: readonly string[]): GasEstimateOptions {
  let target: string | undefined;
  let functionName: string | undefined;
  let value: string | undefined;
  const args: string[] = [];

  for (let index = 1; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (arg === undefined || arg === "--json") {
      continue;
    }
    if (arg === "--value") {
      const amount = commandArgs[index + 1];
      if (amount === undefined) {
        throw new ProjectError({
          code: "missing_flag_value",
          message: "Missing value for --value.",
          hint: "Pass an ETH amount after --value.",
        });
      }
      value = amount;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new ProjectError({
        code: "gas_estimate_arg_unsupported",
        message: `Unsupported gas estimate argument: ${arg}`,
        hint: "Use `consol gas estimate <target> <function> [args...] [--value <amount>]`.",
      });
    }

    if (target === undefined) {
      target = arg;
    } else if (functionName === undefined) {
      functionName = arg;
    } else {
      args.push(arg);
    }
  }

  if (target === undefined || functionName === undefined) {
    throw new ProjectError({
      code: "gas_estimate_args_required",
      message: "Missing target or function for gas estimate.",
      hint: "Use `consol gas estimate <target> <function> [args...]`.",
    });
  }

  return {
    target,
    functionName,
    args,
    ...(value === undefined ? {} : { value }),
  };
}

function estimateContext(input: {
  readonly target: string;
  readonly contract: string;
  readonly address: string;
  readonly functionName: string;
  readonly network: string;
  readonly chainId: number | null;
  readonly from: string | null;
  readonly value?: string;
}): GasEstimateData["signal"]["context"] {
  return {
    target: input.target,
    contract: input.contract,
    address: input.address,
    function: input.functionName,
    network: input.network,
    chain_id: input.chainId,
    ...(input.from === null ? {} : { from: input.from }),
    ...(input.value === undefined ? {} : { value: input.value }),
  };
}
