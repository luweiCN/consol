#!/usr/bin/env bun
import { findFoundryProjectRoot, loadConsolConfig, ProjectError } from "@consol/core";
import { resolveLocale } from "@consol/i18n";
import { createErrorEnvelope, createUserError } from "@consol/protocol";
import { parseCliArgs } from "./args";
import { ndjsonEvent } from "./commands/ndjson";
import { routeCli } from "./router";
import { VERSION } from "./version";

export { VERSION };

export type CliEnv = Readonly<Record<string, string | undefined>>;

export type CliResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type RunCliOptions = {
  readonly env?: CliEnv;
  readonly cwd?: string;
};

export async function runCli(args: readonly string[], options: RunCliOptions = {}): Promise<CliResult> {
  const env = options.env ?? Bun.env;
  const cwd = options.cwd ?? process.cwd();
  const configuredLanguage = loadConsolConfig(env).ui?.language;
  const locale = resolveLocale({ ...(configuredLanguage === undefined ? {} : { configuredLanguage }), env });
  const parsed = parseCliArgs(args);
  if (!parsed.ok) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${parsed.error.message}\n`,
    };
  }

  try {
    return await routeCli({ parsed: parsed.value, locale, cwd, env });
  } catch (error) {
    return errorResult({
      error,
      command: parsed.value.command ?? "help",
      projectRoot: projectRootForError(cwd, parsed.value.globals.project),
      json: parsed.value.globals.json || parsed.value.commandArgs.includes("--json"),
      ndjson: parsed.value.globals.ndjson || parsed.value.commandArgs.includes("--ndjson"),
    });
  }
}

function errorResult(input: {
  readonly error: unknown;
  readonly command: string;
  readonly projectRoot: string | undefined;
  readonly json: boolean;
  readonly ndjson: boolean;
}): CliResult {
  const error =
    input.error instanceof ProjectError
      ? createUserError({
          code: input.error.code,
          message: input.error.message,
          ...(input.error.hint === undefined ? {} : { hint: input.error.hint }),
        })
      : createUserError({
          code: "internal_error",
          message: input.error instanceof Error ? input.error.message : String(input.error),
        });

  const meta = {
    version: VERSION,
    command: input.command,
    ...(input.projectRoot === undefined ? {} : { project_root: input.projectRoot }),
  };

  if (input.ndjson) {
    return {
      exitCode: 1,
      stdout: ndjsonEvent({
        type: "error",
        sequence: 0,
        data: { error },
        meta,
      }),
      stderr: "",
    };
  }

  if (input.json) {
    const envelope = createErrorEnvelope({ error, meta });
    return { exitCode: 1, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 1, stdout: "", stderr: `${error.message}\n` };
}

function projectRootForError(cwd: string, configuredProjectRoot: string | undefined): string | undefined {
  return configuredProjectRoot ?? findFoundryProjectRoot(cwd)?.projectRoot;
}

if (import.meta.main) {
  const result = await runCli(Bun.argv.slice(2));
  if (result.stdout) {
    await Bun.write(Bun.stdout, result.stdout);
  }
  if (result.stderr) {
    await Bun.write(Bun.stderr, result.stderr);
  }
  process.exit(result.exitCode);
}
