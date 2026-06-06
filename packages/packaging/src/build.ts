import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import solidPlugin from "@opentui/solid/bun-plugin";
import type { BunPlugin } from "bun";

export type PackageBuildInput = {
  readonly repoRoot: string;
  readonly outDir: string;
  readonly binaryName?: string;
  readonly target?: PackageCompileTarget;
};

export type PackageBuildResult = {
  readonly binaryPath: string;
  readonly stdout: string;
  readonly stderr: string;
};

const packageCompileTargets = [
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-linux-arm64",
  "bun-linux-x64",
  "bun-windows-arm64",
  "bun-windows-x64",
] as const;

export type PackageCompileTarget = (typeof packageCompileTargets)[number];

export function currentPlatformBinaryName(): string {
  return process.platform === "win32" ? "consol.exe" : "consol";
}

export function currentBunCompileTarget(): PackageCompileTarget {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "bun-darwin-arm64";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "bun-darwin-x64";
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "bun-linux-arm64";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "bun-linux-x64";
  }
  if (process.platform === "win32" && process.arch === "arm64") {
    return "bun-windows-arm64";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "bun-windows-x64";
  }

  throw new Error(`Unsupported Bun compile platform: ${process.platform}/${process.arch}`);
}

export async function buildPackage(input: PackageBuildInput): Promise<PackageBuildResult> {
  const binaryPath = join(input.outDir, input.binaryName ?? currentPlatformBinaryName());
  mkdirSync(input.outDir, { recursive: true });

  const result = await Bun.build({
    entrypoints: [resolve(input.repoRoot, "packages/cli/src/main.ts")],
    target: "bun",
    plugins: [workspaceAliasPlugin(input.repoRoot), treeSitterTextAssetPlugin(input.repoRoot), solidPlugin],
    compile: {
      target: input.target ?? currentBunCompileTarget(),
      outfile: binaryPath,
      autoloadBunfig: false,
    },
  });
  const stderr = formatBuildLogs(result.logs);

  if (!result.success) {
    throw new Error(`package build failed\n${stderr}`);
  }

  return { binaryPath, stdout: "", stderr };
}

function repoRootFromScript(): string {
  return resolve(import.meta.dir, "../../..");
}

function parseBuildArgs(args: readonly string[]): {
  readonly outDir: string;
  readonly binaryName?: string;
  readonly target?: PackageCompileTarget;
} {
  let outDir = "dist";
  let binaryName: string | undefined;
  let target: PackageCompileTarget | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--outdir") {
      outDir = requiredValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--binary-name") {
      binaryName = requiredValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--target") {
      target = parseCompileTarget(requiredValue(args, index, arg));
      index += 1;
      continue;
    }

    throw new Error(`Unsupported package build argument: ${arg}`);
  }

  return {
    outDir,
    ...(binaryName === undefined ? {} : { binaryName }),
    ...(target === undefined ? {} : { target }),
  };
}

function requiredValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

if (import.meta.main) {
  const repoRoot = repoRootFromScript();
  const args = parseBuildArgs(Bun.argv.slice(2));
  const result = await buildPackage({
    repoRoot,
    outDir: resolve(repoRoot, args.outDir),
    ...(args.binaryName === undefined ? {} : { binaryName: args.binaryName }),
    ...(args.target === undefined ? {} : { target: args.target }),
  });
  console.log(`built ${result.binaryPath}`);
}

function formatBuildLogs(logs: readonly unknown[]): string {
  return logs.map((log) => buildLogMessage(log)).join("\n");
}

function buildLogMessage(log: unknown): string {
  if (isRecord(log) && typeof log.message === "string") {
    return log.message;
  }

  return String(log);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCompileTarget(value: string): PackageCompileTarget {
  if (isPackageCompileTarget(value)) {
    return value;
  }

  throw new Error(`Unsupported Bun compile target: ${value}`);
}

function isPackageCompileTarget(value: string): value is PackageCompileTarget {
  return packageCompileTargets.some((target) => target === value);
}

function workspaceAliasPlugin(repoRoot: string): BunPlugin {
  return {
    name: "consol-workspace-alias",
    setup(build) {
      build.onResolve({ filter: /^@consol\/[a-z0-9-]+(?:\/.*)?$/ }, (args) => {
        const path = workspaceImportPath(repoRoot, args.path);
        if (path === null) {
          return;
        }

        return { path };
      });
    },
  };
}

function treeSitterTextAssetPlugin(repoRoot: string): BunPlugin {
  return {
    name: "consol-tree-sitter-text-assets",
    setup(build) {
      build.onResolve({ filter: /(?:parser\.worker\.js|tree-sitter\.js|highlights\.scm)$/ }, (args) => {
        if (!args.importer.endsWith("packages/tui/src/SolidityTreeSitter.ts")) {
          return;
        }

        const path = treeSitterTextAssetPath(repoRoot, args.path);
        return path === null ? undefined : { path, namespace: "consol-tree-sitter-text-asset" };
      });

      build.onLoad({ filter: /.*/, namespace: "consol-tree-sitter-text-asset" }, (args) => ({
        contents: `export default ${JSON.stringify(readFileSync(args.path, "utf8"))};`,
        loader: "js",
      }));
    },
  };
}

function treeSitterTextAssetPath(repoRoot: string, specifier: string): string | null {
  if (specifier === "../../../node_modules/@opentui/core/parser.worker.js") {
    return resolve(repoRoot, "node_modules/@opentui/core/parser.worker.js");
  }

  if (specifier === "../../../node_modules/web-tree-sitter/tree-sitter.js") {
    return resolve(repoRoot, "node_modules/web-tree-sitter/tree-sitter.js");
  }

  if (specifier === "tree-sitter-solidity/queries/highlights.scm") {
    return resolve(repoRoot, "node_modules/tree-sitter-solidity/queries/highlights.scm");
  }

  return null;
}

function workspaceImportPath(repoRoot: string, specifier: string): string | null {
  const match = /^@consol\/([^/]+)(?:\/(.+))?$/.exec(specifier);
  const packageName = match?.[1];
  if (packageName === undefined) {
    return null;
  }

  const subpath = match?.[2];
  const packageRoot = resolve(repoRoot, "packages", packageName, "src");
  const unresolved = subpath === undefined ? workspaceEntrypoint(packageRoot, packageName) : resolve(packageRoot, subpath);
  return resolveSourcePath(unresolved);
}

function workspaceEntrypoint(packageRoot: string, packageName: string): string {
  if (packageName === "tui") {
    return resolve(packageRoot, "index.tsx");
  }

  return resolve(packageRoot, "index.ts");
}

function resolveSourcePath(path: string): string | null {
  const candidates = [path, `${path}.ts`, `${path}.tsx`, resolve(path, "index.ts"), resolve(path, "index.tsx")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}
