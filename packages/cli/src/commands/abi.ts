import { readContractArtifact, resolveArtifactPath, resolveTarget } from "@consol/core";
import { createSuccessEnvelope } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import { sortJsonObjectKeys } from "../json";
import type { CliResult } from "../main";
import { VERSION } from "../version";

export type RunAbiCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
};

export function runAbiCommand(input: RunAbiCommandInput): CliResult {
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
    contract: resolved.contractName,
    source_mode: resolved.sourceMode,
    project_root: resolved.projectRoot,
    artifact_path: artifactPath,
    abi: sortJsonObjectKeys(artifact.abi),
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "abi",
        project_root: data.project_root,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `${JSON.stringify(data.abi, null, 2)}\n`, stderr: "" };
}

function commandTarget(commandArgs: readonly string[]): string | undefined {
  return commandArgs.find((arg) => arg !== "--json");
}
