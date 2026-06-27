import { describe, expect, test } from "bun:test";
import { deploymentEntry, libraryDeploymentCacheKey } from "./deploy-cache";

describe("libraryDeploymentCacheKey", () => {
  test("binds source, name, network and bytecode hash with a lib: namespace", () => {
    expect(
      libraryDeploymentCacheKey({
        source: "src/MathLib.sol",
        name: "MathLib",
        networkName: "anvil",
        bytecodeHash: "deadbeef",
      }),
    ).toBe("lib:src/MathLib.sol:MathLib:anvil:deadbeef");
  });
});

describe("deploymentEntry kind", () => {
  const base = {
    contract: "MathLib",
    address: "0xabc",
    network: "anvil",
    deployed_at_unix: 1,
    bytecode_hash: "deadbeef",
    constructor_args_hash: "0",
  };

  test("defaults to contract when kind is absent", () => {
    expect(deploymentEntry(base)?.kind).toBe("contract");
  });

  test("reads library kind when present", () => {
    expect(deploymentEntry({ ...base, kind: "library" })?.kind).toBe("library");
  });
});
