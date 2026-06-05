import { describe, expect, test } from "bun:test";
import { accessSync, constants, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

type CommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

const repoRoot = resolve(import.meta.dir, "../../..");
const rootPackageJson = join(repoRoot, "package.json");
const cliPackageJson = join(repoRoot, "packages/cli/package.json");

describe("package bin smoke", () => {
  test("package bin entries point at the Bun CLI entry", () => {
    const rootBin = consolBinPath(rootPackageJson);
    const cliBin = consolBinPath(cliPackageJson);

    expect(rootBin).toBe(join(repoRoot, "packages/cli/src/main.ts"));
    expect(cliBin).toBe(rootBin);
    expect(readFileSync(rootBin, "utf8").split("\n")[0]).toBe("#!/usr/bin/env bun");

    if (process.platform !== "win32") {
      accessSync(rootBin, constants.X_OK);
    }
  });

  test("root package bin runs help as an executable command", async () => {
    if (process.platform === "win32") {
      return;
    }

    const result = await runCommand([consolBinPath(rootPackageJson), "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("ConSol is a terminal-first Solidity/EVM development console built on Foundry.");
  });
});

function consolBinPath(packageJsonPath: string): string {
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`${packageJsonPath} is not a JSON object`);
  }

  const bin = parsed.bin;
  if (!isRecord(bin) || typeof bin.consol !== "string") {
    throw new Error(`${packageJsonPath} must define bin.consol`);
  }

  return resolve(dirname(packageJsonPath), bin.consol);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function runCommand(command: readonly string[]): Promise<CommandResult> {
  const proc = Bun.spawn([...command], {
    cwd: repoRoot,
    env: {
      ...Bun.env,
      CONSOL_CONFIG_DIR: mkdtempSync(join(tmpdir(), "consol-bin-smoke-config-")),
      CONSOL_LANG: "en-US",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}
