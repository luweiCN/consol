export type FoundryCommandOptions = {
  readonly cwd: string;
  readonly projectRoot?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
};

export type FoundryCommandResult =
  | {
      readonly ok: true;
      readonly command: readonly string[];
      readonly exitCode: 0;
      readonly stdout: string;
      readonly stderr: string;
    }
  | {
      readonly ok: false;
      readonly command: readonly string[];
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
      readonly error: string;
    };

export async function runFoundryCommand(
  command: readonly string[],
  options: FoundryCommandOptions,
): Promise<FoundryCommandResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const proc = Bun.spawn([...command], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timeout =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, timeoutMs)
      : null;

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    readStream(proc.stdout),
    readStream(proc.stderr),
  ]).finally(() => {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  });

  if (timedOut) {
    return {
      ok: false,
      command,
      exitCode: 124,
      stdout,
      stderr,
      error: `${command[0]} timed out after ${timeoutMs}ms`,
    };
  }

  if (exitCode === 0) {
    return {
      ok: true,
      command,
      exitCode,
      stdout,
      stderr,
    };
  }

  return {
    ok: false,
    command,
    exitCode,
    stdout,
    stderr,
    error: `${command[0]} exited with code ${exitCode}`,
  };
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
}
