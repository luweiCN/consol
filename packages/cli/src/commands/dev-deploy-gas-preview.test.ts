import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeFoundry } from "@consol/testkit";
import { createDeployGasPreview } from "./dev-deploy-gas-preview";

describe("createDeployGasPreview with external libraries", () => {
  test("returns a clear hint instead of estimating with placeholder bytecode", async () => {
    const fake = createFakeFoundry();
    const projectRoot = mkdtempSync(join(tmpdir(), "consol-gas-lib-"));
    writeFileSync(join(projectRoot, "foundry.toml"), '[profile.default]\nsrc = "src"\nout = "out"\n');
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "src", "Uses.sol"), "library Uses { function f() external {} }\n");
    const artifactPath = join(projectRoot, "out", "Uses.sol", "Uses.json");
    mkdirSync(join(artifactPath, ".."), { recursive: true });
    writeFileSync(
      artifactPath,
      JSON.stringify({
        abi: [],
        bytecode: { object: "0x73__$abc$__6000", linkReferences: { "src/L.sol": { L: [{ start: 1 }] } } },
        metadata: { settings: { compilationTarget: { "src/Uses.sol": "Uses" } } },
      }),
    );

    const gas = await createDeployGasPreview({
      env: fake.env,
      cwd: projectRoot,
      target: "src/Uses.sol:Uses",
      rpcUrl: "http://127.0.0.1:8545",
      account: { name: "anvil0", address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", signer: "anvil-index" },
      action: "deploy",
      signature: "",
      args: [],
      value: null,
    });

    expect(gas.estimate).toBeUndefined();
    expect(gas.context?.["error"]).toContain("external librar");
    const creates = fake.readCalls().filter((call) => call.tool === "cast" && call.args[0] === "estimate");
    expect(creates).toHaveLength(0);
  });
});
