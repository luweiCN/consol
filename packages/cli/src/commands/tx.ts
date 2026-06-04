import { findFoundryProjectRoot, ProjectError, resolveTarget } from "@consol/core";
import { createSuccessEnvelope } from "@consol/protocol";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { GlobalArgs } from "../args";
import type { CliResult } from "../main";
import { VERSION } from "../version";

export type RunTxCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
};

export function runTxCommand(input: RunTxCommandInput): CliResult {
  if (input.commandArgs[0] !== "list") {
    return { exitCode: 1, stdout: "", stderr: "Unsupported tx command.\n" };
  }

  const target = targetArg(input.commandArgs);
  const resolved =
    target === undefined
      ? null
      : resolveTarget({
          cwd: input.cwd,
          target,
          ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
        });
  const projectRoot = resolved?.projectRoot ?? projectRootForTx(input);
  const contract = resolved?.contractName;
  const data = {
    project_root: projectRoot,
    history_path: historyPath(projectRoot),
    entries: recentEntries(projectRoot, limitArg(input.commandArgs) ?? 20, contract),
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "tx list",
        project_root: projectRoot,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `Transactions: ${data.entries.length}\n`, stderr: "" };
}

function projectRootForTx(input: RunTxCommandInput): string {
  if (input.globals.project !== undefined) {
    return realpathSync(input.globals.project);
  }

  const detected = findFoundryProjectRoot(input.cwd);
  if (detected !== null) {
    return detected.projectRoot;
  }

  throw new ProjectError({
    code: "foundry_project_not_found",
    message: "No foundry.toml was found for tx list.",
    hint: "Run inside a Foundry project or pass --project.",
  });
}

function recentEntries(projectRoot: string, limit: number, contract: string | undefined): readonly unknown[] {
  const path = historyPath(projectRoot);
  if (!existsSync(path)) {
    return [];
  }

  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return [...getArrayProperty(raw, "entries")]
    .filter((entry) => contract === undefined || entryContract(entry) === contract)
    .sort((left, right) => createdAt(right) - createdAt(left))
    .slice(0, limit);
}

function historyPath(projectRoot: string): string {
  return join(projectRoot, ".consol", "transactions.json");
}

function limitArg(commandArgs: readonly string[]): number | undefined {
  const index = commandArgs.indexOf("--limit");
  const value = index === -1 ? undefined : commandArgs[index + 1];
  return value === undefined ? undefined : Number(value);
}

function targetArg(commandArgs: readonly string[]): string | undefined {
  for (let index = 1; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (arg === undefined || arg === "--json") {
      continue;
    }
    if (arg === "--limit") {
      index += 1;
      continue;
    }
    if (!arg.startsWith("--")) {
      return arg;
    }
  }

  return undefined;
}

function entryContract(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const contract = (value as Record<string, unknown>).contract;
  return typeof contract === "string" ? contract : undefined;
}

function createdAt(value: unknown): number {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return 0;
  }

  const created = (value as Record<string, unknown>).created_at_unix;
  return typeof created === "number" ? created : 0;
}

function getArrayProperty(raw: unknown, key: string): readonly unknown[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return [];
  }

  const value = (raw as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}
