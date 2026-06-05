export type ReleaseCheckCommand = readonly [string, ...string[]];

export const releaseCheckCommands = [
  ["bun", "install", "--frozen-lockfile"],
  ["bun", "run", "verify"],
  ["bun", "run", "package:build"],
  ["bun", "run", "package:smoke"],
  ["git", "diff", "--check"],
] as const satisfies readonly ReleaseCheckCommand[];

export async function runReleaseCheck(commands: readonly ReleaseCheckCommand[] = releaseCheckCommands): Promise<void> {
  for (const command of commands) {
    console.log(`$ ${command.join(" ")}`);
    const exitCode = await runCommand(command);
    if (exitCode !== 0) {
      throw new Error(`release check failed: ${command.join(" ")} exited ${exitCode}`);
    }
  }
}

async function runCommand(command: ReleaseCheckCommand): Promise<number> {
  const proc = Bun.spawn([...command], {
    cwd: process.cwd(),
    env: Bun.env,
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

if (import.meta.main) {
  try {
    await runReleaseCheck();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
