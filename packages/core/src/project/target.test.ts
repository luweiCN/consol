import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTarget } from "./target";

describe("target resolution", () => {
  test("resolves a project contract target from the nearest foundry.toml", () => {
    const projectRoot = createFoundryProject("consol-target-project-");
    const nested = join(projectRoot, "src", "nested");
    mkdirSync(nested, { recursive: true });

    expect(resolveTarget({ cwd: nested, target: "Counter" })).toEqual({
      sourceMode: "project",
      projectRoot,
      contractName: "Counter",
    });
  });

  test("resolves file-qualified project targets and infers the contract name", () => {
    const projectRoot = createFoundryProject("consol-target-project-file-");
    const sourceFile = join(projectRoot, "src", "Counter.sol");
    writeFileSync(sourceFile, "contract Counter {}\n");

    expect(resolveTarget({ cwd: projectRoot, target: "src/Counter.sol" })).toEqual({
      sourceMode: "project",
      projectRoot,
      sourceFile: realpathSync(sourceFile),
      contractName: "Counter",
    });
  });

  test("falls back to single-file scratch mode for Solidity files outside a project", () => {
    const root = mkdtempSync(join(tmpdir(), "consol-target-single-"));
    const sourceFile = join(root, "Counter.sol");
    writeFileSync(sourceFile, "contract Counter {}\n");

    const resolved = resolveTarget({ cwd: root, target: sourceFile });

    expect(resolved).toMatchObject({
      sourceMode: "single_file",
      sourceFile: realpathSync(sourceFile),
      contractName: "Counter",
    });
    expect(resolved.projectRoot).toContain("consol-single-file-");
  });

  test("rejects implicit source targets with multiple deployable declarations", () => {
    const projectRoot = createFoundryProject("consol-target-ambiguous-");
    const sourceFile = join(projectRoot, "src", "Multi.sol");
    writeFileSync(sourceFile, "library Lib {}\ncontract Counter {}\n");

    const error = captureError(() => resolveTarget({ cwd: projectRoot, target: "src/Multi.sol" }));

    expect(error).toMatchObject({ code: "target_ambiguous" });
  });
});

function createFoundryProject(prefix: string): string {
  const projectRoot = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
  return realpathSync(projectRoot);
}

function captureError(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }

  throw new Error("expected function to throw");
}
