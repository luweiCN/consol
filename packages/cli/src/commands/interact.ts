import { parseFunctionItem, ProjectError, readStateKeyBook, type ResolvedTarget } from "@consol/core";
import { runCastCall, runCastDecodeAbi } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import type { FunctionItem } from "@consol/core";
import { createRpcAdapter } from "@consol/rpc";
import { basename, dirname } from "node:path";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import { createReadContext } from "./interact-context";
import { foundryResultMessage, runForgeInspectStorageLayoutWithCacheRecovery } from "./storage-layout-inspect";
import { createComplexStorageSnapshot, type ComplexStorageRow, type ComplexStorageSnapshot } from "./storage-state";

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
  readonly storage_values?: readonly ComplexStorageRow[];
  readonly storage_hints?: readonly string[];
  readonly storage_layout_id?: string | null;
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
    rpcUrl: context.rpc_url,
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
  if (options.watch) {
    throw watchNotImplemented("state");
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
      rpcUrl: context.rpc_url,
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

  const complex = filterComplexStorageState(await maybeCreateComplexStorageState({ context, input }), values);
  const data: StateData = {
    contract: context.resolved.contractName,
    address: context.address,
    values,
    ...(complex === null
      ? {}
      : {
        storage_values: complex.rows,
        storage_hints: complex.hints,
        storage_layout_id: complex.layout_id,
      }),
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

  return { exitCode: 0, stdout: stateHuman(data), stderr: "" };
}

function stateHuman(data: StateData): string {
  const lines = [`${data.contract} ${data.address}`];
  if (data.values.length === 0) {
    lines.push("  (no no-argument readers)");
    return `${lines.join("\n")}\n`;
  }

  for (const value of data.values) {
    const displayValue = value.error === undefined || value.error === null ? value.readable ?? value.raw : `! ${value.error}`;
    lines.push(`  ${value.signature} = ${displayValue}`);
  }
  return `${lines.join("\n")}\n`;
}

async function maybeCreateComplexStorageState(input: {
  readonly context: Awaited<ReturnType<typeof createReadContext>>;
  readonly input: RunStateCommandInput;
}): Promise<Awaited<ReturnType<typeof createComplexStorageSnapshot>> | null> {
  try {
    const contractId = contractIdentifier(
      input.context.artifact.raw,
      input.context.artifact.path,
      input.context.resolved.contractName,
    );
    const layout = await runForgeInspectStorageLayoutWithCacheRecovery({
      cwd: input.context.resolved.projectRoot,
      projectRoot: input.context.resolved.projectRoot,
      contractId,
      env: input.input.env,
    });
    if (!layout.ok) {
      return storageLayoutFailureSnapshot(foundryResultMessage(layout));
    }

    return await createComplexStorageSnapshot({
      layoutJson: layout.stdout,
      projectRoot: input.context.resolved.projectRoot,
      target: stateTarget(input.context.resolved),
      contract: input.context.resolved.contractName,
      address: input.context.address,
      rpc: createRpcAdapter({ rpcUrl: input.context.rpc_url }),
      keyBook: readStateKeyBook(input.context.resolved.projectRoot),
      previewLimit: 3,
      mode: "summary",
    });
  } catch (error) {
    return storageLayoutFailureSnapshot(error instanceof Error ? error.message : String(error));
  }
}

function storageLayoutFailureSnapshot(message: string): ComplexStorageSnapshot {
  const summary = message.trim().length === 0 ? "Storage layout is unavailable." : message.trim();
  return {
    layout_id: "layout:error",
    rows: [{
      id: "storage:layout:error",
      kind: "error",
      name: "storage layout",
      type_label: "storage-layout",
      summary,
      detail_available: false,
      error: summary,
    }],
    hints: ["storage layout unavailable; run forge build and refresh"],
  };
}

function filterComplexStorageState(
  snapshot: ComplexStorageSnapshot | null,
  values: readonly StateValue[],
): ComplexStorageSnapshot | null {
  if (snapshot === null) {
    return null;
  }

  const abiReaderNames = new Set(values.map((value) => value.name));
  const rows = snapshot.rows.filter((row) => row.kind !== "scalar" || !abiReaderNames.has(row.name));
  return rows.length === 0 && snapshot.hints.length === 0 ? null : { ...snapshot, rows };
}

function stateTarget(resolved: ResolvedTarget): string {
  return resolved.sourceFile === undefined ? resolved.contractName : `${resolved.sourceFile}:${resolved.contractName}`;
}

function contractIdentifier(rawArtifact: unknown, artifactPath: string, contractName: string): string {
  const source = artifactSource(rawArtifact);
  if (source !== undefined) {
    return `${source}:${contractName}`;
  }

  return `src/${basename(dirname(artifactPath))}:${contractName}`;
}

function artifactSource(rawArtifact: unknown): string | undefined {
  const metadata = getRecordProperty(rawArtifact, "metadata");
  const settings = getRecordProperty(metadata, "settings");
  const compilationTarget = getRecordProperty(settings, "compilationTarget");
  return compilationTarget === undefined ? undefined : Object.keys(compilationTarget)[0];
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
    if (arg === undefined || arg === "--json" || arg === "--ndjson") {
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

function watchNotImplemented(command: "state"): ProjectError {
  return new ProjectError({
    code: "watch_not_implemented",
    message: `\`consol ${command} --watch\` needs a streaming runner before it can be used safely.`,
    hint: `Omit \`--watch\` for a one-shot snapshot until ${command} streaming is implemented.`,
  });
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

function getRecordProperty(raw: unknown, key: string): Record<string, unknown> | undefined {
  const value = getProperty(raw, key);
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function getProperty(raw: unknown, key: string): unknown {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>)[key] : undefined;
}

function unreachable(message: string): never {
  throw new Error(message);
}
