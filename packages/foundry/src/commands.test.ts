import { describe, expect, test } from "bun:test";
import { createFakeFoundry } from "@consol/testkit";
import {
  runCastCalldata,
  runCastGasPrice,
  runCastKeccak,
  runCastNonce,
  runForgeBuild,
  runForgeInspectStorageLayout,
  runForgeTest,
} from "./commands";

describe("Foundry command adapter", () => {
  test("runForgeBuild invokes forge build with root and color disabled", async () => {
    const fake = createFakeFoundry();
    const result = await runForgeBuild({ cwd: fake.root, env: fake.env });

    expect(result.ok).toBe(true);
    expect(fake.readCalls()).toEqual([
      {
        tool: "forge",
        args: ["build", "--root", fake.root, "--color", "never"],
        cwd: fake.root,
      },
    ]);
  });

  test("runForgeTest invokes forge test with root and color disabled", async () => {
    const fake = createFakeFoundry();
    const result = await runForgeTest({ cwd: fake.root, env: fake.env });

    expect(result.ok).toBe(true);
    expect(fake.readCalls()).toEqual([
      {
        tool: "forge",
        args: ["test", "--root", fake.root, "--color", "never"],
        cwd: fake.root,
      },
    ]);
  });

  test("runForgeInspectStorageLayout invokes forge inspect storage-layout as JSON", async () => {
    const fake = createFakeFoundry();
    const result = await runForgeInspectStorageLayout({
      cwd: fake.root,
      env: fake.env,
      contractId: "src/Counter.sol:Counter",
    });

    expect(result.ok).toBe(true);
    expect(fake.readCalls()).toEqual([
      {
        tool: "forge",
        args: ["inspect", "--root", fake.root, "src/Counter.sol:Counter", "storage-layout", "--json"],
        cwd: fake.root,
      },
    ]);
  });

  test("write preview helpers invoke cast with stable arguments", async () => {
    const fake = createFakeFoundry();
    const address = "0x000000000000000000000000000000000000c0Fe";

    await runCastNonce({ cwd: fake.root, env: fake.env, rpcUrl: "http://localhost:8545", address });
    await runCastGasPrice({ cwd: fake.root, env: fake.env, rpcUrl: "http://localhost:8545" });
    await runCastCalldata({ cwd: fake.root, env: fake.env, signature: "setPair((uint256,address))", args: ["(1,0x1)"] });
    await runCastKeccak({ cwd: fake.root, env: fake.env, value: "0x1234" });

    expect(fake.readCalls()).toEqual([
      {
        tool: "cast",
        args: ["nonce", address, "--rpc-url", "http://localhost:8545"],
        cwd: fake.root,
      },
      {
        tool: "cast",
        args: ["gas-price", "--rpc-url", "http://localhost:8545"],
        cwd: fake.root,
      },
      {
        tool: "cast",
        args: ["calldata", "setPair((uint256,address))", "(1,0x1)"],
        cwd: fake.root,
      },
      {
        tool: "cast",
        args: ["keccak", "0x1234"],
        cwd: fake.root,
      },
    ]);
  });
});
