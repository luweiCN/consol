import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverDeployPlan } from "./deploy-plan";

describe("discoverDeployPlan with external libraries", () => {
  test("marks a contract with unresolved linkReferences as non-deployable", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "consol-plan-lib-"));
    const path = join(projectRoot, "out", "Uses.sol", "Uses.json");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        abi: [],
        bytecode: { object: "0x73__$abc$__6000", linkReferences: { "src/L.sol": { L: [{ start: 1 }] } } },
        metadata: { settings: { compilationTarget: { "src/Uses.sol": "Uses" } } },
      }),
    );

    const plan = discoverDeployPlan(projectRoot);
    const item = plan.find((entry) => entry.contract === "Uses");
    expect(item?.deployable).toBe(false);
    expect(item?.reason).toBe("contract links external libraries; deploy it directly with `consol deploy <target>`");
  });
});
