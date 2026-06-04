import { activeNetworkRuntime, ProjectError, type NetworkRuntime } from "@consol/core";
import { runCastBlockNumber, runCastChainId, startAnvil, terminatePid, terminateProcessOnPort } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";

export type ChainStatusData = {
  readonly running: boolean;
  readonly managed: boolean;
  readonly pid: number | null;
  readonly rpc_url: string;
  readonly fork_url: string | null;
  readonly fork_block_number: number | null;
  readonly chain_id: number | null;
  readonly block_number: number | null;
  readonly log_file: string;
};

export type ChainActionData = {
  readonly action: "already_running" | "started" | "stopped" | "not_running";
  readonly status: ChainStatusData;
};

export type ChainRestartData = {
  readonly action: "restarted";
  readonly stop_action: ChainActionData["action"];
  readonly status: ChainStatusData;
};

export type RunChainCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
};

export async function runChainCommand(input: RunChainCommandInput): Promise<CliResult> {
  const subcommand = chainSubcommand(input.commandArgs);
  if (subcommand === "start") {
    return await chainStart(input);
  }
  if (subcommand === "stop") {
    return await chainStop(input);
  }
  if (subcommand === "restart") {
    return await chainRestart(input);
  }
  if (subcommand !== "status") {
    return { exitCode: 1, stdout: "", stderr: "Unsupported chain command.\n" };
  }

  return await chainStatus(input);
}

async function chainStatus(input: RunChainCommandInput): Promise<CliResult> {
  const network = activeNetworkRuntime(input.env);
  const data = await readChainStatus(input, network);

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "chain status",
        network: network.meta,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return {
    exitCode: 0,
    stdout: `Chain running: ${data.running}\n  managed: ${data.managed}\n  rpc: ${data.rpc_url}\n  chain id: ${
      data.chain_id ?? "unknown"
    }\n  block: ${data.block_number ?? "unknown"}\n  pid: unknown\n  log: ${data.log_file}\n`,
    stderr: "",
  };
}

async function chainStart(input: RunChainCommandInput): Promise<CliResult> {
  const network = activeNetworkRuntime(input.env);
  ensureLocalChainNetwork(network);
  return chainActionResult(input, network, await chainStartData(input, network));
}

async function chainStop(input: RunChainCommandInput): Promise<CliResult> {
  const network = activeNetworkRuntime(input.env);
  ensureLocalChainNetwork(network);
  const stopped = await stopManagedChain(input.env);
  await Bun.sleep(250);
  return chainActionResult(input, network, {
    action: stopped ? "stopped" : "not_running",
    status: await readChainStatus(input, network),
  });
}

async function chainRestart(input: RunChainCommandInput): Promise<CliResult> {
  const network = activeNetworkRuntime(input.env);
  ensureLocalChainNetwork(network);
  const stopped = await stopManagedChain(input.env);
  await Bun.sleep(250);
  const started = await chainStartData(input, network);
  return chainRestartResult(input, network, {
    action: "restarted",
    stop_action: stopped ? "stopped" : "not_running",
    status: started.status,
  });
}

async function chainStartData(input: RunChainCommandInput, network: NetworkRuntime): Promise<ChainActionData> {
  const status = await readChainStatus(input, network);
  if (status.running) {
    return { action: "already_running", status };
  }

  const started = startAnvil({
    cwd: input.cwd,
    env: input.env,
    logFile: status.log_file,
    chainId: network.meta.chain_id,
    forkUrl: network.meta.fork_url,
    forkBlockNumber: network.meta.fork_block_number,
  });
  if (!started.ok) {
    throw new ProjectError({
      code: "anvil_start_failed",
      message: `Failed to start anvil: ${started.error}`,
      hint: "Install Foundry and make sure `anvil` is on PATH.",
    });
  }

  writePidFile(input.env, started.pid);
  return { action: "started", status: await waitForChainStatus(input, network) };
}

function chainActionResult(
  input: RunChainCommandInput,
  network: NetworkRuntime,
  data: ChainActionData,
): CliResult {
  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: `chain ${data.action}`,
        network: network.meta,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return {
    exitCode: 0,
    stdout: `chain ${data.action}\n  running: ${data.status.running}\n  rpc: ${data.status.rpc_url}\n  chain id: ${
      data.status.chain_id ?? "unknown"
    }\n  log: ${data.status.log_file}\n`,
    stderr: "",
  };
}

function chainRestartResult(input: RunChainCommandInput, network: NetworkRuntime, data: ChainRestartData): CliResult {
  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "chain restart",
        network: network.meta,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return {
    exitCode: 0,
    stdout: `chain restarted\n  previous: ${data.stop_action}\n  running: ${data.status.running}\n  rpc: ${data.status.rpc_url}\n  chain id: ${
      data.status.chain_id ?? "unknown"
    }\n  log: ${data.status.log_file}\n`,
    stderr: "",
  };
}

async function waitForChainStatus(input: RunChainCommandInput, network: NetworkRuntime): Promise<ChainStatusData> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = await readChainStatus(input, network);
    if (status.running) {
      return status;
    }

    await Bun.sleep(150);
  }

  throw new ProjectError({
    code: "anvil_start_timeout",
    message: "Anvil process started but RPC did not become reachable.",
    hint: `Check the log file at ${anvilLogFile(input.env)}.`,
  });
}

async function readChainStatus(
  input: RunChainCommandInput,
  network: NetworkRuntime,
): Promise<ChainStatusData> {
  const chainId = await castNumber("chain-id", {
    cwd: input.cwd,
    env: input.env,
    rpcUrl: network.rpc_url,
  });
  const blockNumber = await castNumber("block-number", {
    cwd: input.cwd,
    env: input.env,
    rpcUrl: network.rpc_url,
  });
  const pid = managedPid(input.env);
  return {
    running: chainId !== null,
    managed: pid !== null,
    pid,
    rpc_url: network.rpc_url,
    fork_url: network.meta.fork_url,
    fork_block_number: network.meta.fork_block_number,
    chain_id: chainId,
    block_number: blockNumber,
    log_file: anvilLogFile(input.env),
  };
}

type CastNumberCommand = "chain-id" | "block-number";

type CastNumberInput = {
  readonly cwd: string;
  readonly env: CliEnv;
  readonly rpcUrl: string;
};

async function castNumber(command: CastNumberCommand, input: CastNumberInput): Promise<number | null> {
  const result =
    command === "chain-id"
      ? await runCastChainId({ cwd: input.cwd, env: input.env, rpcUrl: input.rpcUrl })
      : await runCastBlockNumber({ cwd: input.cwd, env: input.env, rpcUrl: input.rpcUrl });
  if (!result.ok) {
    return null;
  }

  const value = Number.parseInt(result.stdout.trim(), 10);
  return Number.isInteger(value) ? value : null;
}

function chainSubcommand(commandArgs: readonly string[]): string | undefined {
  return commandArgs.find((arg) => arg !== "--json");
}

function anvilLogFile(env: CliEnv): string {
  return join(anvilStateDir(env), "anvil-8545.log");
}

function anvilPidFile(env: CliEnv): string {
  return join(anvilStateDir(env), "anvil-8545.pid");
}

function anvilStateDir(env: CliEnv): string {
  const home = env.HOME?.trim() || ".";
  return join(home, ".cache", "consol", "anvil");
}

function writePidFile(env: CliEnv, pid: number): void {
  mkdirSync(anvilStateDir(env), { recursive: true, mode: 0o700 });
  writeFileSync(anvilPidFile(env), `${pid}\n`, { mode: 0o600 });
}

async function stopManagedChain(env: CliEnv): Promise<boolean> {
  const pid = readPidFile(env);
  let stopped = false;
  if (pid !== null) {
    stopped = terminatePid(pid);
    removePidFile(env);
  }

  if (!stopped) {
    stopped = await terminateProcessOnPort(8545);
  }

  return stopped;
}

function managedPid(env: CliEnv): number | null {
  const pid = readPidFile(env);
  if (pid === null || !pidIsAlive(pid)) {
    removePidFile(env);
    return null;
  }

  return pid;
}

function readPidFile(env: CliEnv): number | null {
  const path = anvilPidFile(env);
  if (!existsSync(path)) {
    return null;
  }

  const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
  return Number.isInteger(pid) ? pid : null;
}

function removePidFile(env: CliEnv): void {
  try {
    unlinkSync(anvilPidFile(env));
  } catch {
    // Best effort cleanup only.
  }
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function ensureLocalChainNetwork(network: NetworkRuntime): void {
  if (network.meta.kind === "anvil" || network.meta.kind === "anvil-fork") {
    return;
  }

  throw new ProjectError({
    code: "remote_chain_lifecycle_unsupported",
    message: `Cannot start or stop remote network \`${network.meta.name}\`.`,
    hint: "Use `consol network status` for remote RPCs; only local Anvil and Anvil fork profiles are manageable.",
  });
}
