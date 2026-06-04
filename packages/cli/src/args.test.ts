import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "./args";

describe("parseCliArgs", () => {
  test("parses global flags before the command", () => {
    expect(
      parseCliArgs([
        "--json",
        "--ndjson",
        "--profile",
        "dev",
        "--network",
        "local",
        "--rpc-url",
        "http://localhost:8545",
        "--chain-id",
        "31337",
        "--account",
        "anvil0",
        "--signer",
        "anvil0",
        "--project",
        "/tmp/project",
        "--yes",
        "--confirm-network",
        "local",
        "--no-color",
        "-vv",
        "detect",
        "src/Counter.sol:Counter",
      ]),
    ).toEqual({
      ok: true,
      value: {
        command: "detect",
        commandArgs: ["src/Counter.sol:Counter"],
        globals: {
          json: true,
          ndjson: true,
          profile: "dev",
          network: "local",
          rpcUrl: "http://localhost:8545",
          chainId: 31337,
          account: "anvil0",
          signer: "anvil0",
          project: "/tmp/project",
          yes: true,
          confirmNetwork: "local",
          noColor: true,
          verbose: 2,
        },
      },
    });
  });

  test("reports missing global flag values", () => {
    expect(parseCliArgs(["--network"])).toEqual({
      ok: false,
      error: {
        code: "missing_flag_value",
        message: "Missing value for --network.",
        hint: "Pass a value after --network.",
        details: { flag: "--network" },
      },
    });
  });
});
