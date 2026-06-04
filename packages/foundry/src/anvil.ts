import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { FoundryCommandOptions } from "./commands";

export type AnvilStartOptions = FoundryCommandOptions & {
  readonly logFile: string;
  readonly chainId: number | null;
  readonly forkUrl: string | null;
  readonly forkBlockNumber: number | null;
};

export type AnvilStartResult =
  | {
      readonly ok: true;
      readonly command: readonly string[];
      readonly pid: number;
      readonly logFile: string;
    }
  | {
      readonly ok: false;
      readonly command: readonly string[];
      readonly logFile: string;
      readonly error: string;
    };

export async function terminateProcessOnPort(port: number): Promise<boolean> {
  if (process.platform === "win32") {
    return false;
  }

  try {
    const proc = Bun.spawn(["lsof", "-ti", `tcp:${port}`], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const [exitCode, stdout] = await Promise.all([proc.exited, readStream(proc.stdout)]);
    if (exitCode !== 0) {
      return false;
    }

    let stopped = false;
    for (const pid of parsePids(stdout)) {
      stopped = terminatePid(pid) || stopped;
    }
    return stopped;
  } catch {
    return false;
  }
}

export function terminatePid(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGTERM");
      return true;
    } catch {
      // Fall back to terminating the process itself.
    }
  }

  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

export function startAnvil(options: AnvilStartOptions): AnvilStartResult {
  const command = anvilCommand(options);
  try {
    mkdirSync(dirname(options.logFile), { recursive: true });
    writeFileSync(options.logFile, "", { flag: "a" });
    const proc = Bun.spawn([...command], {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    return { ok: true, command, pid: proc.pid, logFile: options.logFile };
  } catch (error) {
    return {
      ok: false,
      command,
      logFile: options.logFile,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function anvilCommand(options: AnvilStartOptions): readonly string[] {
  const command = ["anvil", "--host", "127.0.0.1", "--port", "8545"];
  if (options.chainId !== null) {
    command.push("--chain-id", String(options.chainId));
  }
  if (options.forkUrl !== null) {
    command.push("--fork-url", options.forkUrl);
    if (options.forkBlockNumber !== null) {
      command.push("--fork-block-number", String(options.forkBlockNumber));
    }
  }
  return command;
}

function parsePids(output: string): readonly number[] {
  return output
    .split(/\r?\n/)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
}
