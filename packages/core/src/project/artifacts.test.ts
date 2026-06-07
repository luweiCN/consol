import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  readContractArtifact,
  resolveArtifactPath,
  stableHash,
  type ResolvedTarget,
} from "./artifacts";

describe("artifact resolution", () => {
  test("resolves single-file artifact path from scratch root and source file name", () => {
    const originalSource = join(mkdtempSync(join(tmpdir(), "consol-artifact-source-")), "Counter.sol");
    const target: ResolvedTarget = {
      sourceMode: "single_file",
      projectRoot: mkdtempSync(join(tmpdir(), "consol-artifact-scratch-")),
      sourceFile: originalSource,
      contractName: "Counter",
    };

    expect(resolveArtifactPath(target)).toBe(
      join(target.projectRoot, "out", basename(originalSource), "Counter.json"),
    );
  });

  test("uses compilation target metadata to disambiguate file-qualified project artifacts", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "consol-artifact-project-"));
    const sourceFile = join(projectRoot, "src", "Counter.sol");
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(sourceFile, "contract Counter {}\n");
    writeArtifact({
      path: join(projectRoot, "out", "src", "Counter.sol", "Counter.json"),
      source: "src/Counter.sol",
      contractName: "Counter",
    });
    writeArtifact({
      path: join(projectRoot, "out", "test", "Counter.sol", "Counter.json"),
      source: "test/Counter.sol",
      contractName: "Counter",
    });

    expect(
      resolveArtifactPath({
        sourceMode: "project",
        projectRoot,
        sourceFile,
        contractName: "Counter",
      }),
    ).toBe(join(projectRoot, "out", "src", "Counter.sol", "Counter.json"));
  });

  test("uses Foundry cache to disambiguate stale file-qualified project artifacts", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "consol-artifact-foundry-cache-"));
    const sourceFile = join(projectRoot, "src", "day-01", "ClickCounter.sol");
    mkdirSync(join(projectRoot, "src", "day-01"), { recursive: true });
    writeFileSync(sourceFile, "contract ClickCounter {}\n");
    writeArtifactWithoutMetadata(join(projectRoot, "out", "1.ClickCounter.sol", "ClickCounter.json"));
    writeArtifactWithoutMetadata(join(projectRoot, "out", "ClickCounter.sol", "ClickCounter.json"));
    mkdirSync(join(projectRoot, "cache"), { recursive: true });
    writeFileSync(
      join(projectRoot, "cache", "solidity-files-cache.json"),
      JSON.stringify({
        files: {
          "src/day-01/ClickCounter.sol": {
            artifacts: {
              ClickCounter: {
                "0.8.35": {
                  default: {
                    path: "ClickCounter.sol/ClickCounter.json",
                  },
                },
              },
            },
          },
        },
      }),
    );

    expect(
      resolveArtifactPath({
        sourceMode: "project",
        projectRoot,
        sourceFile,
        contractName: "ClickCounter",
      }),
    ).toBe(join(projectRoot, "out", "ClickCounter.sol", "ClickCounter.json"));
  });

  test("rejects duplicate unqualified project artifacts", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "consol-artifact-ambiguous-"));
    writeArtifact({
      path: join(projectRoot, "out", "src", "Counter.sol", "Counter.json"),
      source: "src/Counter.sol",
      contractName: "Counter",
    });
    writeArtifact({
      path: join(projectRoot, "out", "test", "Counter.sol", "Counter.json"),
      source: "test/Counter.sol",
      contractName: "Counter",
    });

    const error = captureError(() =>
      resolveArtifactPath({
        sourceMode: "project",
        projectRoot,
        contractName: "Counter",
      }),
    );

    expect(error).toMatchObject({ code: "target_ambiguous" });
  });

  test("suggests clean rebuild when stale file-qualified artifacts cannot be resolved", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "consol-artifact-stale-unresolved-"));
    const sourceFile = join(projectRoot, "src", "day-01", "ClickCounter.sol");
    mkdirSync(join(projectRoot, "src", "day-01"), { recursive: true });
    writeFileSync(sourceFile, "contract ClickCounter {}\n");
    writeArtifactWithoutMetadata(join(projectRoot, "out", "1.ClickCounter.sol", "ClickCounter.json"));
    writeArtifactWithoutMetadata(join(projectRoot, "out", "ClickCounter.sol", "ClickCounter.json"));

    const error = captureError(() =>
      resolveArtifactPath({
        sourceMode: "project",
        projectRoot,
        sourceFile,
        contractName: "ClickCounter",
      }),
    );

    expect(error).toMatchObject({
      code: "target_ambiguous",
      hint: "Run `forge clean && forge build` to remove stale artifacts, then try again.",
    });
  });

  test("reads abi summary, compiler gas estimates, and bytecode hash", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "consol-artifact-read-"));
    const artifactPath = join(projectRoot, "out", "Counter.sol", "Counter.json");
    writeArtifact({
      path: artifactPath,
      source: "src/Counter.sol",
      contractName: "Counter",
      artifact: {
        bytecode: { object: "0x6000" },
        gasEstimates: { creation: { codeDepositCost: "4000" } },
        abi: [
          { type: "constructor", inputs: [] },
          { type: "function", name: "count", inputs: [], outputs: [{ type: "uint256" }] },
          { type: "event", name: "Changed", inputs: [], anonymous: false },
          { type: "error", name: "Unauthorized", inputs: [] },
        ],
      },
    });

    expect(readContractArtifact(artifactPath)).toMatchObject({
      path: artifactPath,
      bytecodeHash: "2a63e0e2aae52643",
      abiSummary: {
        constructor: true,
        functions: 1,
        events: 1,
        errors: 1,
      },
      compilerGasEstimates: { creation: { codeDepositCost: "4000" } },
    });
    expect(stableHash("0x6000")).toBe("2a63e0e2aae52643");
  });
});

function writeArtifact(input: {
  readonly path: string;
  readonly source: string;
  readonly contractName: string;
  readonly artifact?: Readonly<Record<string, unknown>>;
}): void {
  mkdirSync(join(input.path, ".."), { recursive: true });
  writeFileSync(
    input.path,
    JSON.stringify({
      abi: [],
      metadata: {
        settings: {
          compilationTarget: {
            [input.source]: input.contractName,
          },
        },
      },
      ...input.artifact,
    }),
  );
}

function writeArtifactWithoutMetadata(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify({ abi: [], id: 0 }));
}

function captureError(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }

  throw new Error("expected function to throw");
}
