import { describe, expect, test } from "bun:test";
import { createFakeFoundry } from "@consol/testkit";
import {
  runCastCalldata,
  runCastBalance,
  runCastGasPrice,
  runCastKeccak,
  runCastNonce,
  runCastSend,
  runForgeBuild,
  runForgeCreate,
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

  test("runForgeInspectStorageLayout can force recompilation for stale artifacts", async () => {
    const fake = createFakeFoundry();
    const result = await runForgeInspectStorageLayout({
      cwd: fake.root,
      env: fake.env,
      contractId: "src/Counter.sol:Counter",
      force: true,
    });

    expect(result.ok).toBe(true);
    expect(fake.readCalls()).toEqual([
      {
        tool: "forge",
        args: ["inspect", "--root", fake.root, "--force", "src/Counter.sol:Counter", "storage-layout", "--json"],
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

  test("write commands do not expose private keys in argv", async () => {
    const fake = createFakeFoundry();
    const privateKey = "0xabc123";
    const from = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

    await runForgeCreate({
      cwd: fake.root,
      env: fake.env,
      contractId: "src/Counter.sol:Counter",
      rpcUrl: "http://localhost:8545",
      wallet: { kind: "unlocked", from },
      constructorArgs: [],
    });
    await runCastSend({
      cwd: fake.root,
      env: fake.env,
      rpcUrl: "http://localhost:8545",
      address: "0x000000000000000000000000000000000000c0Fe",
      signature: "setPair(uint256)",
      args: ["7"],
      wallet: { kind: "unlocked", from },
    });

    const argv = fake.readCalls().flatMap((call) => call.args);
    expect(argv).toContain("--unlocked");
    expect(argv).toContain("--from");
    expect(argv).toContain(from);
    expect(argv).not.toContain("--private-key");
    expect(argv).not.toContain(privateKey);
  });

  test("commands time out instead of waiting indefinitely", async () => {
    const fake = createFakeFoundry();

    const result = await runCastBalance({
      cwd: fake.root,
      env: { ...fake.env, CONSOL_FAKE_FOUNDRY_SLEEP_MS: "100" },
      rpcUrl: "http://localhost:8545",
      selector: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      timeoutMs: 10,
    });

    if (result.ok) {
      throw new Error("expected cast balance to time out");
    }
    expect(result.exitCode).toBe(124);
    expect(result.error).toContain("timed out");
  });
});
