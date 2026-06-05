import { createSuccessEnvelope } from "@consol/protocol";
import { runForgeBuild } from "@consol/foundry";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import { parseBuildDiagnostics } from "./diagnostics";
import { createGasCompileData, type FunctionGas } from "./gas";

export type RunHintsCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
};

export async function runHintsCommand(input: RunHintsCommandInput): Promise<CliResult> {
  const file = flagValue(input.commandArgs, "--file") ?? "";
  const contract = flagValue(input.commandArgs, "--contract");
  const target = contract === undefined ? file : `${file}:${contract}`;
  const gas = createGasCompileData({
    cwd: input.cwd,
    target,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  const build = await runForgeBuild({
    cwd: gas.project_root,
    projectRoot: gas.project_root,
    env: input.env,
  });
  const source = readFileSync(sourceReadPath(input.cwd, file), "utf8");
  const data = {
    target,
    file,
    contract: gas.contract,
    project_root: gas.project_root,
    diagnostics: parseBuildDiagnostics(build.stdout, build.stderr),
    gas_hints: gas.functions.map((functionGas) => gasHint(functionGas, source)),
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "hints",
        project_root: data.project_root,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `Hints: ${data.target}\n`, stderr: "" };
}

function gasHint(functionGas: FunctionGas, source: string): unknown {
  const gasLabel = functionGas.finite ? functionGas.gas : "infinite";
  return {
    signature: functionGas.signature,
    gas: functionGas.gas,
    finite: functionGas.finite,
    signal: functionGas.signal,
    line: functionLine(source, functionGas.signature),
    message: `gas: ${gasLabel}`,
  };
}

function functionLine(source: string, signature: string): number | null {
  const name = signature.split("(")[0];
  if (name === undefined || name === "") {
    return null;
  }

  const needle = `function ${name}`;
  const publicVar = ` public ${name}`;
  const index = source.split(/\r?\n/).findIndex((line) => {
    return line.includes(needle) || (line.includes(publicVar) && line.trimEnd().endsWith(";"));
  });
  return index === -1 ? null : index + 1;
}

function flagValue(commandArgs: readonly string[], flag: string): string | undefined {
  const index = commandArgs.indexOf(flag);
  return index === -1 ? undefined : commandArgs[index + 1];
}

function sourceReadPath(cwd: string, file: string): string {
  return isAbsolute(file) ? file : resolve(cwd, file);
}
