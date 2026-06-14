import { activeNetworkRuntime } from "@consol/core";
import { runCastRun } from "@consol/foundry";
import type { CliEnv } from "../main";

/**
 * Runs `cast run` against a transaction hash and returns the formatted call
 * trace (the indented call tree / revert location), or null when unavailable.
 */
export async function createDevTrace(
  input: { readonly cwd: string; readonly env: CliEnv },
  txHash: string,
): Promise<string | null> {
  const runtime = activeNetworkRuntime(input.env);
  const run = await runCastRun({ cwd: input.cwd, env: input.env, rpcUrl: runtime.rpc_url, txHash });
  return run.ok ? run.stdout.trim() : null;
}
