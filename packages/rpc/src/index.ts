import { createPublicClient, http, webSocket, type Address, type Chain, type Hex } from "viem";

export type RpcTransportKind = "http" | "websocket";
export type RpcNetworkKind = "local" | "remote";

export type RpcBlockTag = "latest" | "earliest" | "pending" | "safe" | "finalized";

export type RpcGetBlockInput = {
  readonly blockNumber?: bigint;
  readonly blockTag?: RpcBlockTag;
};

export type RpcGetLogsInput = {
  readonly address?: Address | readonly Address[];
  readonly fromBlock?: bigint | RpcBlockTag;
  readonly toBlock?: bigint | RpcBlockTag;
  readonly blockHash?: Hex;
  readonly event?: unknown;
  readonly args?: unknown;
};

export type RpcWatchBlockNumberInput = {
  readonly onBlockNumber: (blockNumber: bigint) => void;
  readonly pollingInterval?: number;
  readonly emitOnBegin?: boolean;
};

export type RpcWatchContractEventInput = {
  readonly address: Address | readonly Address[];
  readonly abi?: unknown;
  readonly eventName?: string;
  readonly args?: unknown;
  readonly fromBlock?: bigint | RpcBlockTag;
  readonly onLogs: (logs: readonly unknown[]) => void;
  readonly pollingInterval?: number;
};

export type RpcPublicClientLike = {
  readonly getBalance: (input: { readonly address: Address }) => Promise<bigint>;
  readonly watchBlockNumber: (input: RpcWatchBlockNumberInput) => () => void;
  readonly watchContractEvent?: (input: RpcWatchContractEventInput) => () => void;
  readonly waitForTransactionReceipt: (input: { readonly hash: Hex }) => Promise<unknown>;
  readonly getTransactionReceipt: (input: { readonly hash: Hex }) => Promise<unknown>;
  readonly getTransaction: (input: { readonly hash: Hex }) => Promise<unknown>;
  readonly getBlock: (input: RpcGetBlockInput) => Promise<unknown>;
  readonly getLogs: (input: RpcGetLogsInput) => Promise<readonly unknown[]>;
};

export type RpcAdapter = {
  readonly getBalance: (address: string) => Promise<bigint>;
  readonly watchBlockNumber: (onBlockNumber: (blockNumber: bigint) => void) => () => void;
  readonly watchContractEvent: (input: Omit<RpcWatchContractEventInput, "address"> & { readonly address: string | readonly string[] }) => () => void;
  readonly waitForTransactionReceipt: (hash: string) => Promise<unknown>;
  readonly getTransactionReceipt: (hash: string) => Promise<unknown>;
  readonly getTransaction: (hash: string) => Promise<unknown>;
  readonly getBlock: (input?: RpcGetBlockInput) => Promise<unknown>;
  readonly getLogs: (input: RpcGetLogsInput) => Promise<readonly unknown[]>;
};

export type CreateRpcAdapterInput = {
  readonly rpcUrl: string;
  readonly networkKind?: RpcNetworkKind;
  readonly chain?: Chain;
  readonly pollingIntervalMs?: number;
  readonly retryCount?: number;
  readonly retryDelayMs?: number;
};

export function createRpcAdapter(input: CreateRpcAdapterInput): RpcAdapter {
  const pollingInterval = input.pollingIntervalMs ?? rpcPollingIntervalMs(input);
  const transport = rpcTransportKind(input.rpcUrl) === "websocket"
    ? webSocket(input.rpcUrl, { retryCount: 0 })
    : http(input.rpcUrl, { retryCount: 0 });
  const client = createPublicClient({
    ...(input.chain === undefined ? {} : { chain: input.chain }),
    transport,
    pollingInterval,
  }) as unknown as RpcPublicClientLike;

  return createRpcAdapterFromPublicClient(client, {
    pollingIntervalMs: pollingInterval,
    ...(input.retryCount === undefined ? {} : { retryCount: input.retryCount }),
    ...(input.retryDelayMs === undefined ? {} : { retryDelayMs: input.retryDelayMs }),
  });
}

export function createRpcAdapterFromPublicClient(
  client: RpcPublicClientLike,
  options: { readonly pollingIntervalMs: number; readonly retryCount?: number; readonly retryDelayMs?: number },
): RpcAdapter {
  const retryOptions = {
    retryCount: options.retryCount ?? 2,
    retryDelayMs: options.retryDelayMs ?? 150,
  };
  return {
    getBalance: async (address) => await withRetry(() => client.getBalance({ address: address as Address }), retryOptions),
    watchBlockNumber: (onBlockNumber) => client.watchBlockNumber({
      emitOnBegin: true,
      pollingInterval: options.pollingIntervalMs,
      onBlockNumber,
    }),
    watchContractEvent: (input) => {
      const normalized = {
        ...input,
        address: normalizeAddressInput(input.address),
        pollingInterval: input.pollingInterval ?? options.pollingIntervalMs,
      };
      if (client.watchContractEvent !== undefined) {
        return client.watchContractEvent(normalized);
      }

      let previousBlock: bigint | undefined = typeof input.fromBlock === "bigint" ? input.fromBlock : undefined;
      return client.watchBlockNumber({
        emitOnBegin: true,
        pollingInterval: options.pollingIntervalMs,
        onBlockNumber: (blockNumber) => {
          const fromBlock = previousBlock === undefined ? blockNumber : previousBlock + 1n;
          previousBlock = blockNumber;
          void withRetry(
            () =>
              client.getLogs({
                address: normalized.address,
                fromBlock,
                toBlock: blockNumber,
                ...(input.eventName === undefined ? {} : { event: input.eventName }),
                ...(input.args === undefined ? {} : { args: input.args }),
              }),
            retryOptions,
          )
            .then((logs) => {
              if (logs.length > 0) {
                input.onLogs(logs);
              }
            })
            .catch(() => {});
        },
      });
    },
    waitForTransactionReceipt: async (hash) =>
      await withRetry(() => client.waitForTransactionReceipt({ hash: hash as Hex }), retryOptions),
    getTransactionReceipt: async (hash) =>
      await withRetry(() => client.getTransactionReceipt({ hash: hash as Hex }), retryOptions),
    getTransaction: async (hash) => await withRetry(() => client.getTransaction({ hash: hash as Hex }), retryOptions),
    getBlock: async (input = {}) => await withRetry(() => client.getBlock(input), retryOptions),
    getLogs: async (input) => await withRetry(() => client.getLogs(input), retryOptions),
  };
}

async function withRetry<T>(
  operation: () => Promise<T>,
  options: { readonly retryCount: number; readonly retryDelayMs: number },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retryCount; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === options.retryCount) {
        break;
      }
      if (options.retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs));
      }
    }
  }
  throw lastError;
}

function normalizeAddressInput(value: string | readonly string[]): Address | readonly Address[] {
  return Array.isArray(value) ? value.map((address) => address as Address) : value as Address;
}

export function rpcTransportKind(rpcUrl: string): RpcTransportKind {
  return rpcUrl.startsWith("ws://") || rpcUrl.startsWith("wss://") ? "websocket" : "http";
}

export function rpcPollingIntervalMs(input: { readonly networkKind?: RpcNetworkKind; readonly rpcUrl?: string }): number {
  if (input.networkKind === "local" || isLocalRpcUrl(input.rpcUrl)) {
    return 1_500;
  }

  return 10_000;
}

function isLocalRpcUrl(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch {
    return false;
  }
}
