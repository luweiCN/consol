import { ProjectError, stableHash, writePrivateFile, type NetworkRuntime } from "@consol/core";
import { runCastBlockNumber, runCastChainId, startAnvil, terminatePid, terminateProcessOnPort } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import { restoreChainDeploymentSnapshot, writeChainDeploymentSnapshot } from "./chain-deployment-snapshot";
import { resolveCliNetworkRuntime } from "./network-runtime";

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

export type ChainStateSnapshotData = {
  readonly name: string;
  readonly file: string;
  readonly network: string;
  readonly chain_id: number | null;
  readonly created_at_unix: number;
};

export type ChainStateActionData = {
  readonly action: "saved" | "restored" | "reset";
  readonly state: ChainStateSnapshotData | null;
  readonly status: ChainStatusData;
};

export type ChainStatesData = {
  readonly states: readonly ChainStateSnapshotData[];
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
  if (subcommand === "reset") {
    return await chainReset(input);
  }
  if (subcommand === "save") {
    return await chainSaveState(input);
  }
  if (subcommand === "restore" || subcommand === "load") {
    return await chainRestoreState(input);
  }
  if (subcommand === "states") {
    return chainStates(input);
  }
  if (subcommand !== "status") {
    return { exitCode: 1, stdout: "", stderr: "Unsupported chain command.\n" };
  }

  return await chainStatus(input);
}

async function chainStatus(input: RunChainCommandInput): Promise<CliResult> {
  const network = resolveCliNetworkRuntime({ globals: input.globals, env: input.env });
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
  const network = resolveCliNetworkRuntime({ globals: input.globals, env: input.env });
  ensureLocalChainNetwork(network);
  return chainActionResult(input, network, await chainStartData(input, network));
}

async function chainStop(input: RunChainCommandInput): Promise<CliResult> {
  const network = resolveCliNetworkRuntime({ globals: input.globals, env: input.env });
  ensureLocalChainNetwork(network);
  const stopped = await stopManagedChain(input.env);
  await Bun.sleep(250);
  return chainActionResult(input, network, {
    action: stopped ? "stopped" : "not_running",
    status: await readChainStatus(input, network),
  });
}

async function chainRestart(input: RunChainCommandInput): Promise<CliResult> {
  const network = resolveCliNetworkRuntime({ globals: input.globals, env: input.env });
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

async function chainReset(input: RunChainCommandInput): Promise<CliResult> {
  const data = await resetLocalChainData(input, undefined);
  const network = resolveChainRuntime(input, undefined);
  return chainStateActionResult(input, network, data);
}

async function chainSaveState(input: RunChainCommandInput): Promise<CliResult> {
  const name = chainArgument(input.commandArgs, "save");
  if (name === undefined) {
    throw new ProjectError({
      code: "chain_state_name_required",
      message: "State name is required.",
      hint: "Run `consol chain save <name>`.",
    });
  }

  const data = await saveLocalChainStateData(input, undefined, name);
  const network = resolveChainRuntime(input, undefined);
  return chainStateActionResult(input, network, data);
}

async function chainRestoreState(input: RunChainCommandInput): Promise<CliResult> {
  const subcommand = chainSubcommand(input.commandArgs) ?? "restore";
  const name = chainArgument(input.commandArgs, subcommand);
  if (name === undefined) {
    throw new ProjectError({
      code: "chain_state_name_required",
      message: "State name is required.",
      hint: "Run `consol chain restore <name>`.",
    });
  }

  const data = await restoreLocalChainStateData(input, undefined, name);
  const network = resolveChainRuntime(input, undefined);
  return chainStateActionResult(input, network, data);
}

function chainStates(input: RunChainCommandInput): CliResult {
  const network = resolveChainRuntime(input, undefined);
  ensureLocalChainNetwork(network);
  const data: ChainStatesData = { states: readChainStateIndex(input.env).states };
  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "chain states",
        network: network.meta,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return {
    exitCode: 0,
    stdout: data.states.length === 0
      ? "chain states\n  none\n"
      : `chain states\n${data.states.map((state) => `  ${state.name} #${state.chain_id ?? "unknown"}`).join("\n")}\n`,
    stderr: "",
  };
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

export async function startLocalChainData(input: RunChainCommandInput, networkName?: string): Promise<ChainActionData> {
  const network = resolveChainRuntime(input, networkName);
  ensureLocalChainNetwork(network);
  return await chainStartData(input, network);
}

export async function resetLocalChainData(input: RunChainCommandInput, networkName?: string): Promise<ChainStateActionData> {
  const network = resolveChainRuntime(input, networkName);
  ensureLocalChainNetwork(network);
  const status = await readChainStatus(input, network);
  if (!status.running) {
    const started = await chainStartData(input, network);
    return { action: "reset", state: null, status: started.status };
  }

  await anvilRpc(network.rpc_url, "anvil_reset", []);
  return { action: "reset", state: null, status: await readChainStatus(input, network) };
}

export async function saveLocalChainStateData(
  input: RunChainCommandInput,
  networkName: string | undefined,
  name: string,
): Promise<ChainStateActionData> {
  const network = resolveChainRuntime(input, networkName);
  ensureLocalChainNetwork(network);
  const dump = await anvilRpc(network.rpc_url, "anvil_dumpState", []);
  if (typeof dump !== "string" || dump.trim().length === 0) {
    throw new ProjectError({
      code: "chain_state_dump_invalid",
      message: "Anvil returned an invalid state dump.",
      hint: "Check that the selected local RPC supports anvil_dumpState.",
    });
  }

  const createdAtUnix = Math.floor(Date.now() / 1000);
  const state = writeChainStateSnapshot(input.env, {
    name: name.trim(),
    network: network.meta.fingerprint ?? network.meta.name,
    chain_id: network.meta.chain_id,
    created_at_unix: createdAtUnix,
    dump,
  });
  await writeChainDeploymentSnapshot(input, network, state.file);
  return { action: "saved", state, status: await readChainStatus(input, network) };
}

export async function restoreLocalChainStateData(
  input: RunChainCommandInput,
  networkName: string | undefined,
  name: string,
): Promise<ChainStateActionData> {
  const network = resolveChainRuntime(input, networkName);
  ensureLocalChainNetwork(network);
  const state = findChainStateSnapshot(input.env, name);
  if (state === undefined) {
    throw new ProjectError({
      code: "chain_state_not_found",
      message: `Saved chain state \`${name}\` was not found.`,
      hint: "Run `consol chain states` and choose an existing state.",
    });
  }

  const dump = readFileSync(state.file, "utf8").trim();
  await anvilRpc(network.rpc_url, "anvil_loadState", [dump]);
  restoreChainDeploymentSnapshot(input, state.file);
  return { action: "restored", state, status: await readChainStatus(input, network) };
}

export function listLocalChainStates(input: RunChainCommandInput, networkName?: string): readonly ChainStateSnapshotData[] {
  const network = resolveChainRuntime(input, networkName);
  ensureLocalChainNetwork(network);
  return readChainStateIndex(input.env).states;
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

function chainStateActionResult(
  input: RunChainCommandInput,
  network: NetworkRuntime,
  data: ChainStateActionData,
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

  const state = data.state === null ? "" : `\n  state: ${data.state.name}`;
  return {
    exitCode: 0,
    stdout: `chain ${data.action}${state}\n  running: ${data.status.running}\n  rpc: ${data.status.rpc_url}\n`,
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

function chainArgument(commandArgs: readonly string[], subcommand: string): string | undefined {
  const args = commandArgs.filter((arg) => arg !== "--json");
  const index = args.indexOf(subcommand);
  return index < 0 ? undefined : args[index + 1];
}

function resolveChainRuntime(input: RunChainCommandInput, networkName: string | undefined): NetworkRuntime {
  return resolveCliNetworkRuntime({
    globals: networkName === undefined ? input.globals : { ...input.globals, network: networkName },
    env: input.env,
  });
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

function anvilSnapshotsDir(env: CliEnv): string {
  return join(anvilStateDir(env), "states");
}

function anvilStateIndexFile(env: CliEnv): string {
  return join(anvilSnapshotsDir(env), "states.json");
}

type ChainStateIndexFile = {
  readonly version: 1;
  readonly states: readonly ChainStateSnapshotData[];
};

function readChainStateIndex(env: CliEnv): ChainStateIndexFile {
  const path = anvilStateIndexFile(env);
  if (!existsSync(path)) {
    return { version: 1, states: [] };
  }

  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const states = Array.isArray(recordProperty(raw, "states"))
    ? (recordProperty(raw, "states") as readonly unknown[]).flatMap(chainStateSnapshotFromUnknown)
    : [];
  return { version: 1, states };
}

function writeChainStateSnapshot(
  env: CliEnv,
  input: {
    readonly name: string;
    readonly network: string;
    readonly chain_id: number | null;
    readonly created_at_unix: number;
    readonly dump: string;
  },
): ChainStateSnapshotData {
  mkdirSync(anvilSnapshotsDir(env), { recursive: true, mode: 0o700 });
  const file = join(anvilSnapshotsDir(env), `${stableHash(`${input.name}\u0000${input.created_at_unix}`)}.json`);
  writePrivateFile(file, `${input.dump.trim()}\n`);
  const state: ChainStateSnapshotData = {
    name: input.name,
    file,
    network: input.network,
    chain_id: input.chain_id,
    created_at_unix: input.created_at_unix,
  };
  const current = readChainStateIndex(env);
  writePrivateFile(anvilStateIndexFile(env), `${JSON.stringify({
    version: 1,
    states: [state, ...current.states.filter((item) => item.name !== state.name)],
  }, null, 2)}\n`);
  return state;
}

function findChainStateSnapshot(env: CliEnv, name: string): ChainStateSnapshotData | undefined {
  return readChainStateIndex(env).states.find((state) => state.name === name);
}

function chainStateSnapshotFromUnknown(value: unknown): ChainStateSnapshotData[] {
  const record = recordFromUnknown(value);
  const name = stringProperty(record, "name");
  const file = stringProperty(record, "file");
  const network = stringProperty(record, "network");
  const createdAtUnix = numberProperty(record, "created_at_unix");
  if (name === undefined || file === undefined || network === undefined || createdAtUnix === undefined) {
    return [];
  }

  return [{
    name,
    file,
    network,
    chain_id: nullableNumberProperty(record, "chain_id"),
    created_at_unix: createdAtUnix,
  }];
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

async function anvilRpc(rpcUrl: string, method: string, params: readonly unknown[]): Promise<unknown> {
  let payload: unknown;
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    payload = await response.json() as unknown;
  } catch (error) {
    throw new ProjectError({
      code: "anvil_rpc_failed",
      message: `Failed to call ${method}.`,
      hint: error instanceof Error ? error.message : "Check that the local Anvil RPC is running.",
    });
  }

  const error = recordProperty(payload, "error");
  if (error !== undefined) {
    throw new ProjectError({
      code: "anvil_rpc_failed",
      message: `Anvil RPC ${method} failed.`,
      hint: stringProperty(error, "message") ?? "Check the local Anvil RPC.",
    });
  }
  return recordProperty(payload, "result");
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function recordProperty(value: unknown, key: string): unknown {
  return recordFromUnknown(value)?.[key];
}

function stringProperty(value: unknown, key: string): string | undefined {
  const property = recordProperty(value, key);
  return typeof property === "string" ? property : undefined;
}

function numberProperty(value: unknown, key: string): number | undefined {
  const property = recordProperty(value, key);
  return typeof property === "number" ? property : undefined;
}

function nullableNumberProperty(value: unknown, key: string): number | null {
  const property = recordProperty(value, key);
  return typeof property === "number" ? property : null;
}
