import { itemSignature, paramType, ProjectError, type ResolvedTarget } from "@consol/core";
import { runCastLogs, runCastSigEvent } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import { sortJsonObjectKeys } from "../json";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import { createReadContext } from "./interact-context";

export type LogsData = {
  readonly contract: string;
  readonly address: string;
  readonly events: readonly DecodedLog[];
};

export type DecodedLog = {
  readonly address: string | null;
  readonly block_number: number | null;
  readonly transaction_hash: string | null;
  readonly log_index: number | null;
  readonly event: string | null;
  readonly signature: string | null;
  readonly args: readonly DecodedLogArg[];
  readonly raw: unknown;
};

export type DecodedLogArg = {
  readonly name: string;
  readonly kind: string;
  readonly indexed: boolean;
  readonly value: string;
};

export type RunLogsCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
  readonly ensureArtifact?: (resolved: ResolvedTarget) => Promise<void>;
};

type LogsOptions = {
  readonly target: string;
  readonly watch: boolean;
  readonly address?: string;
};

type EventAbi = {
  readonly name: string;
  readonly signature: string;
  readonly topic0: string;
  readonly inputs: readonly EventInput[];
};

type EventInput = {
  readonly name: string;
  readonly kind: string;
  readonly indexed: boolean;
};

export async function runLogsCommand(input: RunLogsCommandInput): Promise<CliResult> {
  const options = parseLogsOptions(input.commandArgs);
  if (options.watch && input.globals.json && !input.globals.ndjson) {
    throw new ProjectError({
      code: "ndjson_required",
      message: "`consol logs --watch` is a stream.",
      hint: "Use `--ndjson` for watch output, or omit `--watch` for one JSON snapshot.",
    });
  }
  if (options.watch) {
    throw watchNotImplemented("logs");
  }

  const context = await createReadContext({
    globals: input.globals,
    cwd: input.cwd,
    env: input.env,
    target: options.target,
    ...(options.address === undefined ? {} : { addressOverride: options.address }),
    ...(input.ensureArtifact === undefined ? {} : { ensureArtifact: input.ensureArtifact }),
  });
  const rawLogsResult = await runCastLogs({
    cwd: context.resolved.projectRoot,
    env: input.env,
    rpcUrl: context.rpc_url,
    address: context.address,
  });
  if (!rawLogsResult.ok) {
    return { exitCode: 1, stdout: "", stderr: "cast logs failed.\n" };
  }

  const rawLogs = parseLogArray(rawLogsResult.stdout);
  const eventIndex = await createEventIndex({
    abi: context.artifact.abi,
    cwd: context.resolved.projectRoot,
    env: input.env,
  });
  const data: LogsData = {
    contract: context.resolved.contractName,
    address: context.address,
    events: rawLogs.map((log) => decodeLog(log, eventIndex)),
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "logs",
        network: context.network,
        account: context.account,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: logsHuman(data), stderr: "" };
}

function logsHuman(data: LogsData): string {
  const lines = [`${data.contract} ${data.address}`];
  if (data.events.length === 0) {
    lines.push("  (no logs)");
    return `${lines.join("\n")}\n`;
  }

  for (const event of data.events) {
    const label = event.signature ?? event.event ?? "unknown event";
    const location = [
      event.block_number === null ? null : `block ${event.block_number}`,
      event.transaction_hash === null ? null : `tx ${event.transaction_hash}`,
      event.log_index === null ? null : `index ${event.log_index}`,
    ]
      .filter((part) => part !== null)
      .join(" ");
    lines.push(`  ${label}${location.length === 0 ? "" : ` ${location}`}`);
    for (const arg of event.args) {
      lines.push(`    ${arg.name}: ${arg.value}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function parseLogsOptions(commandArgs: readonly string[]): LogsOptions {
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
      code: "logs_target_required",
      message: "Missing target for logs.",
      hint: "Use `consol logs <target>`.",
    });
  }

  return {
    target,
    watch,
    ...(address === undefined ? {} : { address }),
  };
}

function watchNotImplemented(command: "logs"): ProjectError {
  return new ProjectError({
    code: "watch_not_implemented",
    message: `\`consol ${command} --watch\` needs a streaming runner before it can be used safely.`,
    hint: `Omit \`--watch\` for a one-shot snapshot until ${command} streaming is implemented.`,
  });
}

async function createEventIndex(input: {
  readonly abi: readonly unknown[];
  readonly cwd: string;
  readonly env: CliEnv;
}): Promise<ReadonlyMap<string, EventAbi>> {
  const entries: Array<readonly [string, EventAbi]> = [];
  for (const item of input.abi.filter((candidate) => getStringProperty(candidate, "type") === "event")) {
    const signature = itemSignature(item);
    const topic = await runCastSigEvent({
      cwd: input.cwd,
      env: input.env,
      signature,
    });
    if (!topic.ok) {
      continue;
    }
    const event = eventAbi(item, signature, topic.stdout.trim());
    if (event !== null) {
      entries.push([event.topic0, event]);
    }
  }
  return new Map(entries);
}

function eventAbi(item: unknown, signature: string, topic0: string): EventAbi | null {
  const name = getStringProperty(item, "name");
  if (name === undefined) {
    return null;
  }

  return {
    name,
    signature,
    topic0,
    inputs: eventInputs(item),
  };
}

function eventInputs(item: unknown): readonly EventInput[] {
  return getArrayProperty(item, "inputs").map((input) => ({
    name: getStringProperty(input, "name") ?? "",
    kind: paramType(input),
    indexed: getBooleanProperty(input, "indexed") ?? false,
  }));
}

function decodeLog(log: unknown, eventIndex: ReadonlyMap<string, EventAbi>): DecodedLog {
  const topics = getArrayProperty(log, "topics").flatMap((topic) => {
    const value = typeof topic === "string" ? topic : null;
    return value === null ? [] : [value];
  });
  const event = topics[0] === undefined ? undefined : eventIndex.get(topics[0]);
  return {
    address: getStringProperty(log, "address") ?? null,
    block_number: hexNumber(getStringProperty(log, "blockNumber")),
    transaction_hash: getStringProperty(log, "transactionHash") ?? null,
    log_index: hexNumber(getStringProperty(log, "logIndex")),
    event: event?.name ?? null,
    signature: event?.signature ?? null,
    args: event === undefined ? [] : decodeEventArgs(event, topics),
    raw: sortJsonObjectKeys(log),
  };
}

function decodeEventArgs(event: EventAbi, topics: readonly string[]): readonly DecodedLogArg[] {
  let indexedTopic = 1;
  return event.inputs.map((input) => {
    const value = input.indexed ? topics[indexedTopic] ?? "" : "";
    if (input.indexed) {
      indexedTopic += 1;
    }
    return {
      name: input.name,
      kind: input.kind,
      indexed: input.indexed,
      value,
    };
  });
}

function parseLogArray(stdout: string): readonly unknown[] {
  const parsed = JSON.parse(stdout) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

function hexNumber(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number.parseInt(value.startsWith("0x") ? value.slice(2) : value, 16);
  return Number.isFinite(parsed) ? parsed : null;
}

function getArrayProperty(raw: unknown, key: string): readonly unknown[] {
  const value = getProperty(raw, key);
  return Array.isArray(value) ? value : [];
}

function getStringProperty(raw: unknown, key: string): string | undefined {
  const value = getProperty(raw, key);
  return typeof value === "string" ? value : undefined;
}

function getBooleanProperty(raw: unknown, key: string): boolean | undefined {
  const value = getProperty(raw, key);
  return typeof value === "boolean" ? value : undefined;
}

function getProperty(raw: unknown, key: string): unknown {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>)[key] : undefined;
}
