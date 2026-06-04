import { describe, expect, test } from "bun:test";
import {
  createRpcAdapterFromPublicClient,
  rpcPollingIntervalMs,
  rpcTransportKind,
  type RpcPublicClientLike,
} from "./index";

describe("rpc adapter", () => {
  test("classifies RPC transports and polling cadence", () => {
    expect(rpcTransportKind("ws://localhost:8545")).toBe("websocket");
    expect(rpcTransportKind("wss://sepolia.example")).toBe("websocket");
    expect(rpcTransportKind("http://localhost:8545")).toBe("http");
    expect(rpcTransportKind("https://rpc.example")).toBe("http");
    expect(rpcPollingIntervalMs({ rpcUrl: "http://127.0.0.1:8545" })).toBe(1_500);
    expect(rpcPollingIntervalMs({ networkKind: "remote", rpcUrl: "https://rpc.example" })).toBe(10_000);
  });

  test("delegates reads and receipt lookups to a viem-compatible public client", async () => {
    const calls: string[] = [];
    const client: RpcPublicClientLike = {
      getBalance: async ({ address }) => {
        calls.push(`balance:${address}`);
        return 42n;
      },
      watchContractEvent: (input) => {
        calls.push(`event:${String(input.address)}`);
        input.onLogs([{ address: input.address, eventName: input.eventName }]);
        return () => {
          calls.push("unevent");
        };
      },
      watchBlockNumber: () => {
        calls.push("watch");
        return () => {
          calls.push("unwatch");
        };
      },
      waitForTransactionReceipt: async ({ hash }) => {
        calls.push(`wait:${hash}`);
        return { transactionHash: hash, status: "success" };
      },
      getTransactionReceipt: async ({ hash }) => {
        calls.push(`receipt:${hash}`);
        return { transactionHash: hash, blockNumber: 7n };
      },
      getTransaction: async ({ hash }) => {
        calls.push(`tx:${hash}`);
        return { hash, nonce: 3 };
      },
      getBlock: async ({ blockNumber }) => {
        calls.push(`block:${String(blockNumber)}`);
        return { number: blockNumber, timestamp: 123n };
      },
      getLogs: async ({ address }) => {
        calls.push(`logs:${String(address)}`);
        return [{ address }];
      },
    };
    const adapter = createRpcAdapterFromPublicClient(client, { pollingIntervalMs: 1_500 });

    await expect(adapter.getBalance("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).resolves.toBe(42n);
    await expect(adapter.waitForTransactionReceipt("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).resolves.toMatchObject({
      status: "success",
    });
    await adapter.getTransactionReceipt("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    await adapter.getTransaction("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    await adapter.getBlock({ blockNumber: 7n });
    await adapter.getLogs({ address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    const eventLogs: unknown[][] = [];
    const unwatchEvents = adapter.watchContractEvent({
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      eventName: "Changed",
      onLogs: (logs) => {
        eventLogs.push([...logs]);
      },
    });
    unwatchEvents();

    expect(calls).toEqual([
      "balance:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "wait:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "receipt:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "tx:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "block:7",
      "logs:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "event:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "unevent",
    ]);
    expect(eventLogs).toEqual([[{ address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", eventName: "Changed" }]]);
  });

  test("watches block numbers with the configured polling interval", () => {
    const watched: Array<{ readonly pollingInterval: number | undefined; readonly emitOnBegin: boolean | undefined }> = [];
    const client: RpcPublicClientLike = {
      getBalance: async () => 0n,
      watchBlockNumber: (input) => {
        watched.push({ pollingInterval: input.pollingInterval, emitOnBegin: input.emitOnBegin });
        input.onBlockNumber(9n);
        return () => {};
      },
      waitForTransactionReceipt: async () => ({}),
      getTransactionReceipt: async () => ({}),
      getTransaction: async () => ({}),
      getBlock: async () => ({}),
      getLogs: async () => [],
    };
    const seen: bigint[] = [];
    const adapter = createRpcAdapterFromPublicClient(client, { pollingIntervalMs: 1_500 });

    adapter.watchBlockNumber((blockNumber) => {
      seen.push(blockNumber);
    });

    expect(watched).toEqual([{ pollingInterval: 1_500, emitOnBegin: true }]);
    expect(seen).toEqual([9n]);
  });

  test("falls back to block polling and getLogs when event watch is unavailable", async () => {
    const calls: string[] = [];
    const client: RpcPublicClientLike = {
      getBalance: async () => 0n,
      watchBlockNumber: (input) => {
        calls.push(`watch:${input.pollingInterval}`);
        input.onBlockNumber(12n);
        input.onBlockNumber(13n);
        return () => {
          calls.push("unwatch");
        };
      },
      waitForTransactionReceipt: async () => ({}),
      getTransactionReceipt: async () => ({}),
      getTransaction: async () => ({}),
      getBlock: async () => ({}),
      getLogs: async ({ address, fromBlock, toBlock }) => {
        calls.push(`logs:${String(address)}:${String(fromBlock)}-${String(toBlock)}`);
        return [{ address, fromBlock, toBlock }];
      },
    };
    const seen: unknown[][] = [];
    const adapter = createRpcAdapterFromPublicClient(client, { pollingIntervalMs: 1_500 });

    const stop = adapter.watchContractEvent({
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      onLogs: (logs) => {
        seen.push([...logs]);
      },
    });
    await Promise.resolve();
    stop();

    expect(calls).toEqual([
      "watch:1500",
      "logs:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:12-12",
      "logs:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:13-13",
      "unwatch",
    ]);
    expect(seen).toEqual([
      [{ address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", fromBlock: 12n, toBlock: 12n }],
      [{ address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", fromBlock: 13n, toBlock: 13n }],
    ]);
  });
});
