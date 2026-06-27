import { describe, expect, test } from "bun:test";
import { decodeEventLog, decodeEventLogArgs } from "./event-log";

const TRANSFER_EVENT = {
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
};

describe("decodeEventLogArgs", () => {
  test("decodes both indexed and non-indexed args in input order", () => {
    const topics = [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8",
      "0x0000000000000000000000003c44cdddb6a900fa2b585dd299e03d12fa4293bc",
    ];
    const data = "0x00000000000000000000000000000000000000000000000000000000000003e8";

    expect(decodeEventLogArgs(TRANSFER_EVENT, topics, data)).toEqual([
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      "1000",
    ]);
  });

  test("returns null when the topics do not match the event", () => {
    expect(decodeEventLogArgs(TRANSFER_EVENT, ["0xdeadbeef"], "0x")).toBe(null);
  });
});

describe("decodeEventLog", () => {
  const TRANSFER_TOPICS = [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8",
    "0x0000000000000000000000003c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  ];
  const TRANSFER_DATA = "0x00000000000000000000000000000000000000000000000000000000000003e8";

  test("resolves the event name and typed args from a full contract ABI", () => {
    const abi = [
      { type: "function", name: "transfer", inputs: [], outputs: [], stateMutability: "nonpayable" },
      TRANSFER_EVENT,
    ];

    expect(decodeEventLog(abi, TRANSFER_TOPICS, TRANSFER_DATA)).toEqual({
      eventName: "Transfer",
      args: [
        { name: "from", type: "address", indexed: true, value: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
        { name: "to", type: "address", indexed: true, value: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" },
        { name: "value", type: "uint256", indexed: false, value: "1000" },
      ],
    });
  });

  test("returns null when no event in the ABI matches the topics", () => {
    expect(decodeEventLog([TRANSFER_EVENT], ["0xdeadbeef"], "0x")).toBe(null);
  });
});
