import { runCastReceipt, runCastRun } from "@consol/foundry";
import { createSuccessEnvelope, createUserError } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import { sortJsonObjectKeys } from "../json";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import { resolveCliReadNetworkRuntime } from "./network-runtime";

export type TraceData = {
  readonly tx_hash: string;
  readonly network: string;
  readonly chain_id: number | null;
  readonly receipt: unknown;
  readonly trace: string;
};

export type RunTraceCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
};

export async function runTraceCommand(input: RunTraceCommandInput): Promise<CliResult> {
  const txHash = traceTxHash(input.commandArgs);
  if (txHash === undefined) {
    const error = createUserError({
      code: "missing_trace_tx_hash",
      message: "Missing transaction hash for trace.",
      hint: "Use `consol trace <tx-hash>`.",
    });
    return { exitCode: 1, stdout: "", stderr: `${error.message}\n` };
  }

  const network = await resolveCliReadNetworkRuntime({ globals: input.globals, cwd: input.cwd, env: input.env });
  const receipt = await runCastReceipt({
    cwd: input.cwd,
    env: input.env,
    rpcUrl: network.rpc_url,
    txHash,
  });
  const run = await runCastRun({
    cwd: input.cwd,
    env: input.env,
    rpcUrl: network.rpc_url,
    txHash,
  });

  if (!receipt.ok || !run.ok) {
    return { exitCode: 1, stdout: "", stderr: "Trace failed.\n" };
  }

  const receiptJson: unknown = JSON.parse(receipt.stdout);
  const data: TraceData = {
    tx_hash: txHash,
    network: network.meta.name,
    chain_id: network.meta.chain_id,
    receipt: sortJsonObjectKeys(receiptJson),
    trace: run.stdout.trim(),
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "trace",
        network: network.meta,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return {
    exitCode: 0,
    stdout: `trace ${data.tx_hash} on ${data.network}\n${data.trace === "" ? "" : `\n${data.trace}\n`}`,
    stderr: "",
  };
}

function traceTxHash(commandArgs: readonly string[]): string | undefined {
  return commandArgs.find((arg) => arg !== "--json");
}
