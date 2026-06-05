import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CliNdjsonEventSchema,
  GasSourceSchema,
  TxPreviewEventSchema,
} from "./events";

const previewEvent = {
  type: "tx.preview",
  id: "preview-1",
  timestamp: "2026-06-03T00:00:00.000Z",
  action: "send",
  network: {
    name: "local",
    chainId: 31337,
    fingerprint: "chain:31337:local",
    writePolicy: "local",
  },
  account: {
    name: "anvil0",
    address: "0x0000000000000000000000000000000000000001",
  },
  signer: {
    name: "anvil0",
    source: "anvil-index",
    address: "0x0000000000000000000000000000000000000001",
    available: true,
  },
  target: {
    display: "src/Counter.sol:Counter",
    contract: "Counter",
    sourceMode: "project",
    sourceFile: "src/Counter.sol",
  },
  calldata: {
    function: "increment",
    signature: "increment()",
    args: [],
    hex: "0xabcdef",
  },
  gas: {
    source: "rpc_estimate",
    estimate: "42000",
    confidence: "high",
  },
};

describe("ConSol protocol events", () => {
  test("parses tx.preview events", () => {
    expect(TxPreviewEventSchema.parse(previewEvent).type).toBe("tx.preview");
  });

  test("limits gas source to known provenance values", () => {
    expect([
      "actual",
      "rpc_estimate",
      "compiler_estimate",
      "test_report",
      "snapshot_delta",
    ].map((source) => GasSourceSchema.parse(source))).toEqual([
      "actual",
      "rpc_estimate",
      "compiler_estimate",
      "test_report",
      "snapshot_delta",
    ]);

    expect(() => GasSourceSchema.parse("unknown")).toThrow();
  });

  test("parses CLI NDJSON golden file", () => {
    const lines = readFileSync("packages/protocol/snapshots/tx-preview.ndjson", "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);

    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      expect(() => CliNdjsonEventSchema.parse(JSON.parse(line))).not.toThrow();
    }
  });
});
