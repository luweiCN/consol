import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { currentPlatformBinaryName } from "./build";

export type CommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type PackageSmokeInput = {
  readonly binaryPath: string;
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
};

export type PackageSmokeResult = {
  readonly version: CommandResult;
  readonly doctor: CommandResult & { readonly ok: boolean };
  readonly dev: CommandResult & { readonly ok: boolean; readonly projectRoot: string };
};

export async function smokeBinary(input: PackageSmokeInput): Promise<PackageSmokeResult> {
  if (!existsSync(input.binaryPath)) {
    throw new Error(`Package smoke binary does not exist: ${input.binaryPath}`);
  }

  const version = await runCommand([input.binaryPath, "--version"], input);
  if (version.exitCode !== 0) {
    throw new Error(`consol --version failed with exit code ${version.exitCode}\n${version.stderr || version.stdout}`);
  }

  const doctor = await runCommand([input.binaryPath, "doctor", "--json"], input);
  if (doctor.exitCode !== 0) {
    throw new Error(`consol doctor --json failed with exit code ${doctor.exitCode}\n${doctor.stderr || doctor.stdout}`);
  }

  const doctorPayload: unknown = JSON.parse(doctor.stdout);
  const ok = isRecord(doctorPayload) && doctorPayload.ok === true;
  if (!ok) {
    throw new Error("consol doctor --json did not report ok: true");
  }

  const projectRoot = createSmokeProject();
  const dev = await runCommand([input.binaryPath, "--json", "--project", projectRoot, "dev", "Counter"], input);
  if (dev.exitCode !== 0) {
    throw new Error(`consol dev --json failed with exit code ${dev.exitCode}\n${dev.stderr || dev.stdout}`);
  }

  const devPayload: unknown = JSON.parse(dev.stdout);
  const devOk = isRecord(devPayload) && devPayload.ok === true && isRecord(devPayload.data) && devPayload.data.contract === "Counter";
  if (!devOk) {
    throw new Error("consol dev --json did not report ok: true for Counter");
  }

  return { version, doctor: { ...doctor, ok }, dev: { ...dev, ok: devOk, projectRoot } };
}

function createSmokeProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "consol-package-dev-smoke-"));
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  mkdirSync(join(projectRoot, "out", "Counter.sol"), { recursive: true });
  writeFileSync(join(projectRoot, "foundry.toml"), '[profile.default]\nsrc = "src"\nout = "out"\n');
  writeFileSync(join(projectRoot, "src", "Counter.sol"), "contract Counter { function number() external view returns (uint256) {} }\n");
  writeFileSync(
    join(projectRoot, "out", "Counter.sol", "Counter.json"),
    JSON.stringify(
      {
        abi: [
          {
            type: "function",
            name: "number",
            stateMutability: "view",
            inputs: [],
            outputs: [{ name: "", type: "uint256" }],
          },
        ],
        bytecode: { object: "0x60016002" },
        metadata: {
          settings: {
            compilationTarget: {
              "src/Counter.sol": "Counter",
            },
          },
        },
      },
      null,
      2,
    ),
  );
  return projectRoot;
}

async function runCommand(command: readonly string[], input: PackageSmokeInput): Promise<CommandResult> {
  const proc = Bun.spawn([...command], {
    cwd: input.cwd,
    env: { ...Bun.env, ...input.env },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function repoRootFromScript(): string {
  return resolve(import.meta.dir, "../../..");
}

function parseSmokeArgs(args: readonly string[]): { readonly binaryPath?: string } {
  let binaryPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--binary") {
      binaryPath = requiredValue(args, index, arg);
      index += 1;
      continue;
    }

    throw new Error(`Unsupported package smoke argument: ${arg}`);
  }

  return binaryPath === undefined ? {} : { binaryPath };
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
  const args = parseSmokeArgs(Bun.argv.slice(2));
  const binaryPath = args.binaryPath ?? join(repoRoot, "dist", currentPlatformBinaryName());
  const result = await smokeBinary({ binaryPath, cwd: repoRoot });
  console.log(result.version.stdout.trim());
  console.log("doctor ok");
  console.log("dev ok");
}
