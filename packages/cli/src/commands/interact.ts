import { parseFunctionItem, ProjectError, type ResolvedTarget } from "@consol/core";
import { runCastCall, runCastDecodeAbi } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import type { FunctionItem } from "@consol/core";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import { createReadContext } from "./interact-context";

export type CallData = {
  readonly contract: string;
  readonly address: string;
  readonly function: string;
  readonly signature: string;
  readonly raw: string;
};

export type RunCallCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
};

export type StateData = {
  readonly contract: string;
  readonly address: string;
  readonly values: readonly StateValue[];
};

export type StateValue = {
  readonly name: string;
  readonly signature: string;
  readonly output_types: readonly string[];
  readonly readable: string | null;
  readonly raw: string;
  readonly error?: string | null;
};

export type RunStateCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
  readonly ensureArtifact?: (resolved: ResolvedTarget) => Promise<void>;
};

type CallOptions = {
  readonly target: string;
  readonly functionName: string;
  readonly args: readonly string[];
};

type StateOptions = {
  readonly target: string;
  readonly watch: boolean;
  readonly address?: string;
};

export async function runCallCommand(input: RunCallCommandInput): Promise<CliResult> {
  const options = parseCallOptions(input.commandArgs);
  const context = await createReadContext({
    globals: input.globals,
    cwd: input.cwd,
    env: input.env,
    target: options.target,
  });

  const signature = resolveFunctionSignature(context.artifact.abi, options.functionName);
  const call = await runCastCall({
    cwd: context.resolved.projectRoot,
    env: input.env,
    rpcUrl: context.network.rpc_url,
    address: context.address,
    signature,
    args: options.args,
  });
  if (!call.ok) {
    return { exitCode: 1, stdout: "", stderr: `cast call failed for ${signature}.\n` };
  }

  const data: CallData = {
    contract: context.resolved.contractName,
    address: context.address,
    function: options.functionName,
    signature,
    raw: call.stdout.trim(),
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "call",
        network: context.network,
        account: context.account,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `${data.contract} ${data.signature} -> ${data.raw}\n`, stderr: "" };
}

export async function runStateCommand(input: RunStateCommandInput): Promise<CliResult> {
  const options = parseStateOptions(input.commandArgs);
  if (options.watch && input.globals.json && !input.globals.ndjson) {
    throw new ProjectError({
      code: "ndjson_required",
      message: "`consol state --watch` is a stream.",
      hint: "Use `--ndjson` for watch output, or omit `--watch` for one JSON snapshot.",
    });
  }

  const context = await createReadContext({
    globals: input.globals,
    cwd: input.cwd,
    env: input.env,
    target: options.target,
    ...(options.address === undefined ? {} : { addressOverride: options.address }),
    ...(input.ensureArtifact === undefined ? {} : { ensureArtifact: input.ensureArtifact }),
  });
  const values: StateValue[] = [];
  for (const reader of noArgumentReaders(context.artifact.abi)) {
    const call = await runCastCall({
      cwd: context.resolved.projectRoot,
      env: input.env,
      rpcUrl: context.network.rpc_url,
      address: context.address,
      signature: reader.signature,
      args: [],
    });
    if (!call.ok) {
      values.push({
        name: reader.name,
        signature: reader.signature,
        output_types: reader.outputs.map((output) => output.kind),
        readable: null,
        raw: "",
        error: castCallFailureMessage(reader.signature),
      });
      continue;
    }

    const raw = call.stdout.trim();
    values.push({
      name: reader.name,
      signature: reader.signature,
      output_types: reader.outputs.map((output) => output.kind),
      readable: await decodeReadable({
        cwd: context.resolved.projectRoot,
        env: input.env,
        outputTypes: reader.outputs.map((output) => output.kind),
        raw,
      }),
      raw,
    });
  }

  const data: StateData = {
    contract: context.resolved.contractName,
    address: context.address,
    values,
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "state",
        network: context.network,
        account: context.account,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `${data.contract} ${data.address}\n`, stderr: "" };
}

function castCallFailureMessage(signature: string): string {
  return `cast call failed for ${signature}.`;
}

function parseCallOptions(commandArgs: readonly string[]): CallOptions {
  const args = commandArgs.filter((arg) => arg !== "--json");
  const target = args[0];
  const functionName = args[1];
  if (target === undefined || functionName === undefined) {
    throw new ProjectError({
      code: "call_args_required",
      message: "Missing target or function for call.",
      hint: "Use `consol call <target> <viewFunction> [args...]`.",
    });
  }

  return {
    target,
    functionName,
    args: args.slice(2),
  };
}

function parseStateOptions(commandArgs: readonly string[]): StateOptions {
  let target: string | undefined;
  let address: string | undefined;
  let watch = false;

  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (arg === undefined || arg === "--json") {
      continue;
    }
    if (arg === "--watch") {
      watch = true;
      continue;
    }
    if (arg === "--address") {
      const nextAddress = commandArgs[index + 1];
      if (nextAddress === undefined) {
        throw new ProjectError({
          code: "missing_flag_value",
          message: "Missing value for --address.",
          hint: "Pass a deployed contract address after --address.",
        });
      }
      address = nextAddress;
      index += 1;
      continue;
    }
    if (target === undefined) {
      target = arg;
    }
  }

  if (target === undefined) {
    throw new ProjectError({
      code: "state_target_required",
      message: "Missing target for state.",
      hint: "Use `consol state <target>`.",
    });
  }

  return {
    target,
    watch,
    ...(address === undefined ? {} : { address }),
  };
}

export function resolveFunctionSignature(abi: readonly unknown[], functionName: string, allowWrite = false): string {
  if (functionName.includes("(")) {
    return functionName;
  }

  const matches = abi
    .filter((item) => getStringProperty(item, "type") === "function")
    .filter((item) => getStringProperty(item, "name") === functionName)
    .map(parseFunctionItem);
  const candidates = allowWrite ? matches : matches.filter(isReadableFunction);
  if (matches.length > 0 && candidates.length === 0) {
    throw new ProjectError({
      code: "function_requires_send",
      message: `Function \`${functionName}\` is not view/pure.`,
      hint: "Use `consol send` for write functions.",
    });
  }

  if (candidates.length === 1) {
    return candidates[0]?.signature ?? unreachable("expected one function signature");
  }

  if (candidates.length === 0) {
    throw new ProjectError({
      code: "function_not_found",
      message: `Function \`${functionName}\` was not found in the ABI.`,
      hint: "Run `consol inspect <target>` to list functions.",
    });
  }

  throw new ProjectError({
    code: "function_ambiguous",
    message: `Function \`${functionName}\` is overloaded.`,
    hint: `Use a full signature. Candidates: ${candidates.map((item) => item.signature).join(", ")}`,
  });
}

function isReadableFunction(item: FunctionItem): boolean {
  return item.state_mutability === "view" || item.state_mutability === "pure";
}

function noArgumentReaders(abi: readonly unknown[]): readonly FunctionItem[] {
  return abi
    .filter((item) => getStringProperty(item, "type") === "function")
    .map(parseFunctionItem)
    .filter(isReadableFunction)
    .filter((item) => item.inputs.length === 0);
}

async function decodeReadable(input: {
  readonly cwd: string;
  readonly env: CliEnv;
  readonly outputTypes: readonly string[];
  readonly raw: string;
}): Promise<string | null> {
  if (input.outputTypes.length === 0) {
    return null;
  }

  const result = await runCastDecodeAbi({
    cwd: input.cwd,
    env: input.env,
    signature: `__consol_decode()(${input.outputTypes.join(",")})`,
    data: input.raw,
  });
  if (!result.ok) {
    return null;
  }

  const values = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return values.length === 0 ? null : values.join(", ");
}

function getStringProperty(raw: unknown, key: string): string | undefined {
  const value = getProperty(raw, key);
  return typeof value === "string" ? value : undefined;
}

function getProperty(raw: unknown, key: string): unknown {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>)[key] : undefined;
}

function unreachable(message: string): never {
  throw new Error(message);
}
