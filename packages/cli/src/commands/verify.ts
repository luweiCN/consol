import { ProjectError, resolveTarget } from "@consol/core";
import { runForgeBuild, runForgeVerifyContract } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import { contractIdentifier } from "./contract-id";
import { resolveCliReadNetworkRuntime } from "./network-runtime";

export type VerifyData = {
  readonly target: string;
  readonly contract: string;
  readonly contract_id: string;
  readonly project_root: string;
  readonly address: string;
  readonly chain: string | null;
  readonly verifier: string | null;
  readonly show_standard_json_input: boolean;
  readonly status: "success" | "failed";
  readonly stdout: string;
  readonly stderr: string;
};

export type RunVerifyCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
};

type VerifyOptions = {
  readonly target: string;
  readonly address?: string;
  readonly chain?: string;
  readonly verifier?: string;
  readonly verifierUrl?: string;
  readonly verifierApiKey?: string;
  readonly etherscanApiKey?: string;
  readonly constructorArgs?: string;
  readonly constructorArgsPath?: string;
  readonly guessConstructorArgs: boolean;
  readonly watch: boolean;
  readonly showStandardJsonInput: boolean;
};

export async function runVerifyCommand(input: RunVerifyCommandInput): Promise<CliResult> {
  const options = parseVerifyOptions(input.commandArgs);
  if (options.constructorArgs !== undefined && options.constructorArgsPath !== undefined) {
    throw new ProjectError({
      code: "verify_constructor_args_conflict",
      message: "`verify` accepts only one of `--constructor-args` or `--constructor-args-path`.",
      hint: "Pass raw constructor args directly, or pass a file path, but not both.",
    });
  }

  const resolved = resolveTarget({
    cwd: input.cwd,
    target: options.target,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  const build = await runForgeBuild({
    cwd: resolved.projectRoot,
    projectRoot: resolved.projectRoot,
    env: input.env,
  });
  if (!build.ok) {
    return { exitCode: 1, stdout: "", stderr: "Foundry build failed before verify.\n" };
  }

  const network = await resolveCliReadNetworkRuntime({ globals: input.globals, cwd: resolved.projectRoot, env: input.env });
  const address = options.address ?? missingAddress();
  const chain = options.chain ?? (network.meta.chain_id === null ? undefined : String(network.meta.chain_id));
  const contractId = contractIdentifier(resolved);
  const verify = await runForgeVerifyContract({
    cwd: resolved.projectRoot,
    projectRoot: resolved.projectRoot,
    env: input.env,
    address,
    contractId,
    rpcUrl: network.rpc_url,
    ...(chain === undefined ? {} : { chain }),
    ...(options.verifier === undefined ? {} : { verifier: options.verifier }),
    ...(options.verifierUrl === undefined ? {} : { verifierUrl: options.verifierUrl }),
    ...(options.verifierApiKey === undefined ? {} : { verifierApiKey: options.verifierApiKey }),
    ...(options.etherscanApiKey === undefined ? {} : { etherscanApiKey: options.etherscanApiKey }),
    ...(options.constructorArgs === undefined ? {} : { constructorArgs: options.constructorArgs }),
    ...(options.constructorArgsPath === undefined ? {} : { constructorArgsPath: options.constructorArgsPath }),
    guessConstructorArgs: options.guessConstructorArgs,
    watch: options.watch,
    showStandardJsonInput: options.showStandardJsonInput,
  });

  const data: VerifyData = {
    target: options.target,
    contract: resolved.contractName,
    contract_id: contractId,
    project_root: resolved.projectRoot,
    address,
    chain: chain ?? null,
    verifier: options.verifier ?? null,
    show_standard_json_input: options.showStandardJsonInput,
    status: verify.ok ? "success" : "failed",
    stdout: verify.stdout,
    stderr: verify.stderr,
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "verify",
        project_root: data.project_root,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return verify.ok
    ? { exitCode: 0, stdout: data.stdout, stderr: data.stderr }
    : { exitCode: 1, stdout: "", stderr: "forge verify-contract failed.\n" };
}

function parseVerifyOptions(commandArgs: readonly string[]): VerifyOptions {
  let target: string | undefined;
  let address: string | undefined;
  let chain: string | undefined;
  let verifier: string | undefined;
  let verifierUrl: string | undefined;
  let verifierApiKey: string | undefined;
  let etherscanApiKey: string | undefined;
  let constructorArgs: string | undefined;
  let constructorArgsPath: string | undefined;
  let guessConstructorArgs = false;
  let watch = false;
  let showStandardJsonInput = false;

  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (arg === undefined || arg === "--json") {
      continue;
    }

    if (!arg.startsWith("--") && target === undefined) {
      target = arg;
      continue;
    }

    if (arg === "--guess-constructor-args") {
      guessConstructorArgs = true;
      continue;
    }
    if (arg === "--watch") {
      watch = true;
      continue;
    }
    if (arg === "--show-standard-json-input") {
      showStandardJsonInput = true;
      continue;
    }

    const value = commandArgs[index + 1];
    if (value === undefined) {
      throw new ProjectError({
        code: "missing_flag_value",
        message: `Missing value for ${arg}.`,
        hint: `Pass a value after ${arg}.`,
      });
    }

    switch (arg) {
      case "--address":
        address = value;
        break;
      case "--chain":
        chain = value;
        break;
      case "--verifier":
        verifier = value;
        break;
      case "--verifier-url":
        verifierUrl = value;
        break;
      case "--verifier-api-key":
        verifierApiKey = value;
        break;
      case "--etherscan-api-key":
        etherscanApiKey = value;
        break;
      case "--constructor-args":
        constructorArgs = value;
        break;
      case "--constructor-args-path":
        constructorArgsPath = value;
        break;
      default:
        throw new ProjectError({
          code: "verify_arg_unsupported",
          message: `Unsupported verify argument: ${arg}`,
          hint: "Use `consol verify <target> --address <address>`.",
        });
    }
    index += 1;
  }

  if (target === undefined) {
    throw new ProjectError({
      code: "verify_target_required",
      message: "Missing target for verify.",
      hint: "Use `consol verify <target> --address <address>`.",
    });
  }

  return {
    target,
    ...(address === undefined ? {} : { address }),
    ...(chain === undefined ? {} : { chain }),
    ...(verifier === undefined ? {} : { verifier }),
    ...(verifierUrl === undefined ? {} : { verifierUrl }),
    ...(verifierApiKey === undefined ? {} : { verifierApiKey }),
    ...(etherscanApiKey === undefined ? {} : { etherscanApiKey }),
    ...(constructorArgs === undefined ? {} : { constructorArgs }),
    ...(constructorArgsPath === undefined ? {} : { constructorArgsPath }),
    guessConstructorArgs,
    watch,
    showStandardJsonInput,
  };
}

function missingAddress(): string {
  throw new ProjectError({
    code: "verify_address_required",
    message: "No verification address was provided.",
    hint: "Pass `--address <address>` or deploy the target first.",
  });
}
