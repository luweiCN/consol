import { ProjectError, readContractArtifact, resolveArtifactPath, resolveTarget } from "@consol/core";
import { runForgeBuild } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import { runGasEstimateCommand } from "./gas-estimate";
import { runGasReportCommand } from "./gas-report";
import { runGasSnapshotCommand } from "./gas-snapshot";

export type RunGasCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
};

export type GasCompileData = {
  readonly target: string;
  readonly contract: string;
  readonly source_mode: "project" | "single_file";
  readonly project_root: string;
  readonly creation: unknown;
  readonly functions: readonly FunctionGas[];
  readonly raw: unknown;
};

export type FunctionGas = {
  readonly signature: string;
  readonly gas: string;
  readonly finite: boolean;
  readonly signal: {
    readonly kind: "compiler_estimate";
    readonly source: "forge inspect gasEstimates";
    readonly confidence: "low" | "none";
    readonly context: {
      readonly contract: string;
      readonly function: string;
    };
    readonly estimate: string;
    readonly error: null;
  };
};

export async function runGasCommand(input: RunGasCommandInput): Promise<CliResult> {
  if (input.commandArgs[0] === "estimate") {
    return await runGasEstimateCommand(input);
  }
  if (input.commandArgs[0] === "report") {
    return await runGasReportCommand(input);
  }
  if (input.commandArgs[0] === "snapshot") {
    return await runGasSnapshotCommand(input);
  }
  if (input.commandArgs[0] !== "compile") {
    return { exitCode: 1, stdout: "", stderr: "Unsupported gas command.\n" };
  }

  const target = input.commandArgs.find((arg, index) => index > 0 && arg !== "--json") ?? "";
  const resolved = resolveTarget({
    cwd: input.cwd,
    target,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  const build = await runForgeBuild({
    cwd: resolved.projectRoot,
    projectRoot: resolved.projectRoot,
    env: input.env,
  });
  if (!build.ok) {
    throw new ProjectError({
      code: "foundry_build_failed",
      message: "Foundry build failed before gas compile.",
      hint: build.stderr.trim() || build.stdout.trim() || build.error,
    });
  }
  const data = createGasCompileData({
    cwd: input.cwd,
    target,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "gas compile",
        project_root: data.project_root,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `Gas estimates: ${data.contract}\n`, stderr: "" };
}

export type CreateGasCompileDataInput = {
  readonly cwd: string;
  readonly target: string;
  readonly projectRoot?: string;
};

export function createGasCompileData(input: CreateGasCompileDataInput): GasCompileData {
  const resolved = resolveTarget({
    cwd: input.cwd,
    target: input.target,
    ...(input.projectRoot === undefined ? {} : { projectRoot: input.projectRoot }),
  });
  const artifact = readContractArtifact(resolveArtifactPath(resolved));
  const raw = artifact.compilerGasEstimates ?? {};
  return {
    target: input.target,
    contract: resolved.contractName,
    source_mode: resolved.sourceMode,
    project_root: resolved.projectRoot,
    creation: getProperty(raw, "creation") ?? null,
    functions: externalFunctions(raw, resolved.contractName),
    raw,
  };
}

function externalFunctions(raw: unknown, contract: string): readonly FunctionGas[] {
  const external = getRecordProperty(raw, "external") ?? {};
  return Object.entries(external)
    .map(([signature, value]): FunctionGas => {
      const gas = typeof value === "string" ? value : JSON.stringify(value);
      const finite = gas !== "infinite";
      return {
        signature,
        gas,
        finite,
        signal: {
          kind: "compiler_estimate",
          source: "forge inspect gasEstimates",
          confidence: finite ? "low" : "none",
          context: {
            contract,
            function: signature,
          },
          estimate: gas,
          error: null,
        },
      };
    })
    .sort((left, right) => left.signature.localeCompare(right.signature));
}

function getRecordProperty(raw: unknown, key: string): Record<string, unknown> | undefined {
  const value = getProperty(raw, key);
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function getProperty(raw: unknown, key: string): unknown {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>)[key] : undefined;
}
