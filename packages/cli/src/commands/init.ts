import { ProjectError } from "@consol/core";
import { createSuccessEnvelope } from "@consol/protocol";
import { copyFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import type { GlobalArgs } from "../args";
import type { CliResult } from "../main";
import { VERSION } from "../version";

export type InitData = {
  readonly project_root: string;
  readonly source_file: string | null;
  readonly copied_source: string | null;
  readonly created: readonly string[];
};

export type RunInitCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
};

type InitOptions = {
  readonly fromFile?: string;
  readonly to?: string;
};

export function runInitCommand(input: RunInitCommandInput): CliResult {
  const options = parseInitOptions(input.commandArgs);
  const projectRoot = resolveProjectRoot(input.cwd, options);
  const sourceFile = options.fromFile === undefined ? null : realpathSync(resolvePath(input.cwd, options.fromFile));
  const data = createProject(projectRoot, sourceFile);

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "init",
        project_root: data.project_root,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  const sourceLine = data.copied_source === null ? "" : `  source: ${data.copied_source}\n`;
  return {
    exitCode: 0,
    stdout: `ConSol project initialized: ${data.project_root}\n${sourceLine}  next:\n    cd ${data.project_root}\n    consol build\n`,
    stderr: "",
  };
}

function parseInitOptions(commandArgs: readonly string[]): InitOptions {
  let fromFile: string | undefined;
  let to: string | undefined;

  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (arg === undefined || arg === "--json") {
      continue;
    }

    if (arg === "--from-file") {
      const value = commandArgs[index + 1];
      if (value === undefined) {
        throw new ProjectError({
          code: "missing_flag_value",
          message: "Missing value for --from-file.",
          hint: "Pass a Solidity file path after --from-file.",
        });
      }
      fromFile = value;
      index += 1;
      continue;
    }

    if (arg === "--to") {
      const value = commandArgs[index + 1];
      if (value === undefined) {
        throw new ProjectError({
          code: "missing_flag_value",
          message: "Missing value for --to.",
          hint: "Pass a destination directory after --to.",
        });
      }
      to = value;
      index += 1;
      continue;
    }

    throw new ProjectError({
      code: "init_arg_unsupported",
      message: `Unsupported init argument: ${arg}`,
      hint: "Use `consol init [--from-file <file.sol>] [--to <dir>]`.",
    });
  }

  return {
    ...(fromFile === undefined ? {} : { fromFile }),
    ...(to === undefined ? {} : { to }),
  };
}

function resolveProjectRoot(cwd: string, options: InitOptions): string {
  if (options.to !== undefined) {
    return resolvePath(cwd, options.to);
  }

  if (options.fromFile !== undefined) {
    const file = resolvePath(cwd, options.fromFile);
    const extension = extname(file);
    const stem = extension.length === 0 ? basename(file) : basename(file, extension);
    if (stem.length === 0) {
      throw new ProjectError({
        code: "init_source_invalid",
        message: `Invalid Solidity source path: ${options.fromFile}`,
      });
    }
    return join(cwd, `${stem}-foundry`);
  }

  return cwd;
}

function createProject(projectRoot: string, sourceFile: string | null): InitData {
  if (existsSync(join(projectRoot, "foundry.toml"))) {
    throw new ProjectError({
      code: "project_already_initialized",
      message: `${projectRoot} already contains foundry.toml.`,
      hint: "Choose a different --to directory or use the existing project.",
    });
  }

  mkdirSync(join(projectRoot, "src"), { recursive: true });
  mkdirSync(join(projectRoot, "test"), { recursive: true });
  mkdirSync(join(projectRoot, "script"), { recursive: true });
  mkdirSync(join(projectRoot, "lib"), { recursive: true });

  const created: string[] = [];
  writeCreatedFile(
    join(projectRoot, "foundry.toml"),
    "[profile.default]\nsrc = \"src\"\nout = \"out\"\nlibs = [\"lib\"]\n",
    created,
  );

  const copiedSource = sourceFile === null ? writeSampleCounter(projectRoot, created) : copySource(projectRoot, sourceFile, created);

  return {
    project_root: projectRoot,
    source_file: sourceFile,
    copied_source: copiedSource,
    created,
  };
}

function copySource(projectRoot: string, sourceFile: string, created: string[]): string {
  const fileName = basename(sourceFile);
  if (fileName.length === 0) {
    throw new ProjectError({
      code: "init_source_invalid",
      message: `Invalid Solidity source path: ${sourceFile}`,
    });
  }

  const destination = join(projectRoot, "src", fileName);
  if (existsSync(destination)) {
    throw new ProjectError({
      code: "init_source_exists",
      message: `${destination} already exists.`,
      hint: "Choose a different --to directory or move the existing file.",
    });
  }

  copyFileSync(sourceFile, destination);
  created.push(destination);
  return destination;
}

function writeSampleCounter(projectRoot: string, created: string[]): string {
  const destination = join(projectRoot, "src", "Counter.sol");
  writeCreatedFile(destination, sampleCounter, created);
  return destination;
}

function writeCreatedFile(path: string, contents: string, created: string[]): void {
  if (existsSync(path)) {
    throw new ProjectError({
      code: "init_file_exists",
      message: `${path} already exists.`,
      hint: "Choose a different --to directory or remove the existing file.",
    });
  }
  writeFileSync(path, contents);
  created.push(path);
}

function resolvePath(cwd: string, path: string): string {
  return resolve(cwd, path);
}

const sampleCounter = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Counter {
    uint256 public number;

    event NumberChanged(uint256 value);

    function setNumber(uint256 newNumber) public {
        number = newNumber;
        emit NumberChanged(newNumber);
    }

    function increment() public {
        number++;
        emit NumberChanged(number);
    }
}
`;
