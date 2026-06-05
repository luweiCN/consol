export type FoundryToolName = "forge" | "cast" | "anvil";

export type FoundryToolStatus = {
  readonly available: boolean;
  readonly version: string | null;
};

export type FoundryToolsStatus = Record<FoundryToolName, FoundryToolStatus>;

export type DetectFoundryToolsOptions = {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
};

const tools = ["forge", "cast", "anvil"] as const satisfies readonly FoundryToolName[];

export async function detectFoundryTools(options: DetectFoundryToolsOptions): Promise<FoundryToolsStatus> {
  const entries: Array<readonly [FoundryToolName, FoundryToolStatus]> = [];
  for (const tool of tools) {
    entries.push([tool, await detectTool(tool, options)] as const);
  }
  return Object.fromEntries(entries) as FoundryToolsStatus;
}

async function detectTool(
  tool: FoundryToolName,
  options: DetectFoundryToolsOptions,
): Promise<FoundryToolStatus> {
  try {
    const proc = Bun.spawn([tool, "--version"], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      readStream(proc.stdout),
      readStream(proc.stderr),
    ]);

    if (exitCode !== 0) {
      return { available: false, version: null };
    }

    const version = stdout.trim() || stderr.trim();
    return { available: true, version };
  } catch {
    return { available: false, version: null };
  }
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) {
    return "";
  }

  return await new Response(stream).text();
}
