import { describe, expect, test } from "bun:test";
import { defaultWritePolicy, detectNetworkKind } from "./permissions";

describe("write policy defaults", () => {
  test("local RPCs use local write policy", () => {
    expect(detectNetworkKind("http://localhost:8545")).toBe("anvil");
    expect(defaultWritePolicy({ kind: "anvil" })).toBe("local");
  });

  test("mainnet requires typed confirmation", () => {
    expect(defaultWritePolicy({ kind: "remote", chainId: 1 })).toBe("typed-confirm");
  });

  test("remote non-mainnet networks require confirmation", () => {
    expect(defaultWritePolicy({ kind: "remote", chainId: 11155111 })).toBe("confirm");
  });
});
