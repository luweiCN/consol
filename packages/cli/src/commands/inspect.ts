import {
  parseEventItem,
  parseFunctionItem,
  parseNamedAbiItem,
  readContractArtifact,
  resolveArtifactPath,
  resolveTarget,
} from "@consol/core";
import { createSuccessEnvelope } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliResult } from "../main";
import { VERSION } from "../version";

export type RunInspectCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
};

export function runInspectCommand(input: RunInspectCommandInput): CliResult {
  const target = commandTarget(input.commandArgs) ?? "";
  const resolved = resolveTarget({
    cwd: input.cwd,
    target,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  const artifactPath = resolveArtifactPath(resolved);
  const artifact = readContractArtifact(artifactPath);
  const data = {
    target,
    source_mode: resolved.sourceMode,
    project_root: resolved.projectRoot,
    source_file: resolved.sourceFile ?? null,
    contract_name: resolved.contractName,
    artifact_path: artifactPath,
    bytecode_hash: artifact.bytecodeHash,
    abi_summary: artifact.abiSummary,
    functions: artifact.abi.filter((item) => abiType(item) === "function").map((item) => inspectFunctionItem(parseFunctionItem(item))),
    events: artifact.abi.filter((item) => abiType(item) === "event").map(parseEventItem),
    errors: artifact.abi.filter((item) => abiType(item) === "error").map(parseNamedAbiItem),
    compiler_gas_estimates: artifact.compilerGasEstimates,
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "inspect",
        project_root: data.project_root,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return {
    exitCode: 0,
    stdout: `${data.contract_name} (${data.source_mode})\n  artifact: ${data.artifact_path}\n`,
    stderr: "",
  };
}

function commandTarget(commandArgs: readonly string[]): string | undefined {
  return commandArgs.find((arg) => arg !== "--json");
}

function inspectFunctionItem(item: ReturnType<typeof parseFunctionItem>) {
  return {
    name: item.name,
    signature: item.signature,
    state_mutability: item.state_mutability,
    inputs: item.inputs,
    outputs: item.outputs,
  };
}

function abiType(item: unknown): string | undefined {
  return typeof item === "object" && item !== null && !Array.isArray(item) && "type" in item
    ? String(item.type)
    : undefined;
}
