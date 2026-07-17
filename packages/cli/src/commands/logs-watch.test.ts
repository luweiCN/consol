import { describe, expect, test } from "bun:test";
import type { DecodedLog } from "./logs";
import { formatWatchEventHuman, normalizeWatchLog } from "./logs-watch";

describe("formatWatchEventHuman", () => {
  const log: DecodedLog = {
    address: "0x000000000000000000000000000000000000c0Fe",
    block_number: 123,
    transaction_hash: "0xabc123",
    log_index: 0,
    event: "PairSet",
    signature: "PairSet(address)",
    args: [
      { name: "owner", kind: "address", indexed: true, value: "0x0000000000000000000000000000000000001234" },
    ],
    raw: {},
  };

  test("includes the event signature, block location and decoded args", () => {
    const text = formatWatchEventHuman(log);
    expect(text).toContain("PairSet(address)");
    expect(text).toContain("123");
    expect(text).toContain("owner");
    expect(text).toContain("0x0000000000000000000000000000000000001234");
  });

  test("falls back to the event name when signature is null", () => {
    const text = formatWatchEventHuman({ ...log, signature: null });
    expect(text).toContain("PairSet");
  });

  test("ends with a newline so events stack cleanly in a live stream", () => {
    expect(formatWatchEventHuman(log).endsWith("\n")).toBe(true);
  });
});

describe("normalizeWatchLog", () => {
  test("converts viem bigint/number fields to hex strings so logs stay decodable and JSON-safe", () => {
    const normalized = normalizeWatchLog({
      blockNumber: 123n,
      logIndex: 0,
      transactionHash: "0xabc",
      topics: ["0xt0"],
      data: "0x",
    }) as Record<string, unknown>;

    expect(normalized.blockNumber).toBe("0x7b");
    expect(normalized.logIndex).toBe("0x0");
    expect(normalized.transactionHash).toBe("0xabc");
    expect(normalized.topics).toEqual(["0xt0"]);
    expect(() => JSON.stringify(normalized)).not.toThrow();
  });

  test("passes non-object inputs through untouched", () => {
    expect(normalizeWatchLog(null)).toBe(null);
    expect(normalizeWatchLog("0x")).toBe("0x");
  });
});
