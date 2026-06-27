import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSingleFileScratchProject,
  findFoundryProjectRoot,
  listScratchProjectRoots,
} from "./detect";

describe("project detection", () => {
  test("finds foundry.toml by walking parent directories", () => {
    const root = mkdtempSync(join(tmpdir(), "consol-project-root-"));
    const nested = join(root, "contracts", "nested");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, "foundry.toml"), "[profile.default]\n");

    expect(findFoundryProjectRoot(nested)).toEqual({
      projectRoot: root,
      foundryToml: join(root, "foundry.toml"),
    });
  });

  test("single-file scratch copies local imports into the scratch project", () => {
    const root = mkdtempSync(join(tmpdir(), "consol-single-file-"));
    mkdirSync(join(root, "lib"), { recursive: true });
    writeFileSync(join(root, "lib/Math.sol"), "library Math {}\n");
    writeFileSync(join(root, "lib/Named.sol"), "library Named {}\n");
    writeFileSync(join(root, "lib/Star.sol"), "library Star {}\n");
    writeFileSync(
      join(root, "Counter.sol"),
      [
        'import "./lib/Math.sol";',
        'import { Named } from "./lib/Named.sol";',
        'import * as Star from "./lib/Star.sol";',
        "contract Counter {}",
      ].join("\n"),
    );

    const scratch = createSingleFileScratchProject({ sourceFile: join(root, "Counter.sol") });

    expect(readFileSync(join(scratch.projectRoot, "src/Counter.sol"), "utf8")).toContain("contract Counter");
    expect(readFileSync(join(scratch.projectRoot, "src/lib/Math.sol"), "utf8")).toContain("library Math");
    expect(readFileSync(join(scratch.projectRoot, "src/lib/Named.sol"), "utf8")).toContain("library Named");
    expect(readFileSync(join(scratch.projectRoot, "src/lib/Star.sol"), "utf8")).toContain("library Star");
  });

  test("single-file scratch rejects parent-directory imports", () => {
    const root = mkdtempSync(join(tmpdir(), "consol-single-file-outside-"));
    writeFileSync(join(root, "Counter.sol"), 'import "../Shared.sol";\ncontract Counter {}\n');
    let error: unknown;

    try {
      createSingleFileScratchProject({ sourceFile: join(root, "Counter.sol") });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "single_file_import_outside_root" });
  });
});

describe("deployment project roots", () => {
  test("lists scratch project roots that have a deployment cache", () => {
    const scratchRoot = mkdtempSync(join(tmpdir(), "consol-scratch-roots-"));
    const withCache = join(scratchRoot, "with-cache");
    mkdirSync(join(withCache, ".consol"), { recursive: true });
    writeFileSync(join(withCache, ".consol", "deployments.json"), '{"version":1,"entries":{}}\n');
    const withoutCache = join(scratchRoot, "without-cache");
    mkdirSync(withoutCache, { recursive: true });

    expect(listScratchProjectRoots(scratchRoot)).toEqual([withCache]);
  });

  test("returns empty list when the scratch root does not exist", () => {
    expect(listScratchProjectRoots(join(tmpdir(), "consol-scratch-missing-zzz"))).toEqual([]);
  });
});
