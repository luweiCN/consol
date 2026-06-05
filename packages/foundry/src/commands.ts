import { join } from "node:path";
import { runFoundryCommand, type FoundryCommandOptions, type FoundryCommandResult } from "./run-command";

export type { FoundryCommandOptions, FoundryCommandResult } from "./run-command";

export async function runForgeBuild(options: FoundryCommandOptions): Promise<FoundryCommandResult> {
  return runFoundryCommand(["forge", "build", "--root", options.projectRoot ?? options.cwd, "--color", "never"], options);
}

export async function runForgeTest(options: FoundryCommandOptions): Promise<FoundryCommandResult> {
  return runFoundryCommand(["forge", "test", "--root", options.projectRoot ?? options.cwd, "--color", "never"], options);
}

export type ForgeGasReportOptions = FoundryCommandOptions & {
  readonly matchContract?: string;
};

export type ForgeGasSnapshotOptions = FoundryCommandOptions & {
  readonly diff: boolean;
  readonly check: boolean;
};

export type ForgeInspectStorageLayoutOptions = FoundryCommandOptions & {
  readonly contractId: string;
};

export type ForgeCreateOptions = FoundryCommandOptions & {
  readonly contractId: string;
  readonly rpcUrl: string;
  readonly wallet: FoundryWallet;
  readonly constructorArgs: readonly string[];
  readonly value?: string;
  readonly gasLimit?: string;
};

export type FoundryWallet =
  | {
      readonly kind: "unlocked";
      readonly from: string;
    }
  | {
      readonly kind: "private-key-env";
      readonly privateKey: string;
    };

export type ForgeVerifyContractOptions = FoundryCommandOptions & {
  readonly address: string;
  readonly contractId: string;
  readonly rpcUrl: string;
  readonly chain?: string;
  readonly verifier?: string;
  readonly verifierUrl?: string;
  readonly verifierApiKey?: string;
  readonly etherscanApiKey?: string;
  readonly constructorArgs?: string;
  readonly constructorArgsPath?: string;
  readonly guessConstructorArgs: boolean;
  readonly watch: boolean;
  readonly showStandardJsonInput: boolean;
};

export type CastRpcOptions = FoundryCommandOptions & {
  readonly rpcUrl: string;
};

export type CastTransactionOptions = CastRpcOptions & {
  readonly txHash: string;
};

export type CastCodeOptions = CastRpcOptions & {
  readonly address: string;
};

export type CastNonceOptions = CastCodeOptions;

export type CastCallOptions = CastCodeOptions & {
  readonly signature: string;
  readonly args: readonly string[];
};

export type CastEstimateOptions = CastCallOptions & {
  readonly value?: string;
  readonly from?: string;
};

export type CastSendOptions = CastCallOptions & {
  readonly wallet: FoundryWallet;
  readonly value?: string;
  readonly gasLimit?: string;
};

export type CastDecodeAbiOptions = FoundryCommandOptions & {
  readonly signature: string;
  readonly data: string;
};

export type CastLogsOptions = CastCodeOptions;

export type CastSigEventOptions = FoundryCommandOptions & {
  readonly signature: string;
};

export type CastBalanceOptions = CastRpcOptions & {
  readonly selector: string;
};

export type CastCalldataOptions = FoundryCommandOptions & {
  readonly signature: string;
  readonly args: readonly string[];
};

export type CastKeccakOptions = FoundryCommandOptions & {
  readonly value: string;
};

export async function runForgeInspectStorageLayout(
  options: ForgeInspectStorageLayoutOptions,
): Promise<FoundryCommandResult> {
  return runFoundryCommand(
    ["forge", "inspect", "--root", options.projectRoot ?? options.cwd, options.contractId, "storage-layout", "--json"],
    options,
  );
}

export async function runForgeCreate(options: ForgeCreateOptions): Promise<FoundryCommandResult> {
  return runFoundryCommand(
    [
      "forge",
      "create",
      "--root",
      options.projectRoot ?? options.cwd,
      options.contractId,
      "--rpc-url",
      options.rpcUrl,
      "--broadcast",
      "--color",
      "never",
      ...walletArgs(options.wallet),
      ...valueFlag(options.value),
      ...gasLimitFlag(options.gasLimit),
      ...constructorArgsFlag(options.constructorArgs),
    ],
    withWalletEnv(options),
  );
}

export async function runForgeGasReport(options: ForgeGasReportOptions): Promise<FoundryCommandResult> {
  const command = ["forge", "test", "--root", options.projectRoot ?? options.cwd, "--gas-report", "--color", "never"];
  pushOptionalFlag(command, "--match-contract", options.matchContract);
  return runFoundryCommand(command, options);
}

export async function runForgeGasSnapshot(options: ForgeGasSnapshotOptions): Promise<FoundryCommandResult> {
  const root = options.projectRoot ?? options.cwd;
  const command = ["forge", "snapshot", "--root", root, "--snap", join(root, ".gas-snapshot"), "--color", "never"];
  if (options.diff) {
    command.push("--diff");
  }
  if (options.check) {
    command.push("--check");
  }
  return runFoundryCommand(command, options);
}

export async function runForgeVerifyContract(options: ForgeVerifyContractOptions): Promise<FoundryCommandResult> {
  const command = [
    "forge",
    "verify-contract",
    options.address,
    options.contractId,
    "--root",
    options.projectRoot ?? options.cwd,
    "--rpc-url",
    options.rpcUrl,
    "--color",
    "never",
  ];

  pushOptionalFlag(command, "--chain", options.chain);
  pushOptionalFlag(command, "--verifier", options.verifier);
  pushOptionalFlag(command, "--verifier-url", options.verifierUrl);
  pushOptionalFlag(command, "--verifier-api-key", options.verifierApiKey);
  pushOptionalFlag(command, "--etherscan-api-key", options.etherscanApiKey);
  pushOptionalFlag(command, "--constructor-args", options.constructorArgs);
  pushOptionalFlag(command, "--constructor-args-path", options.constructorArgsPath);
  if (options.guessConstructorArgs) {
    command.push("--guess-constructor-args");
  }
  if (options.watch) {
    command.push("--watch");
  }
  if (options.showStandardJsonInput) {
    command.push("--show-standard-json-input");
  }

  return runFoundryCommand(command, options);
}

export async function runCastChainId(options: CastRpcOptions): Promise<FoundryCommandResult> {
  return runFoundryCommand(["cast", "chain-id", "--rpc-url", options.rpcUrl], options);
}

export async function runCastBlockNumber(options: CastRpcOptions): Promise<FoundryCommandResult> {
  return runFoundryCommand(["cast", "block-number", "--rpc-url", options.rpcUrl], options);
}

export async function runCastReceipt(options: CastTransactionOptions): Promise<FoundryCommandResult> {
  return runFoundryCommand(["cast", "receipt", options.txHash, "--json", "--async", "--rpc-url", options.rpcUrl], options);
}

export async function runCastRun(options: CastTransactionOptions): Promise<FoundryCommandResult> {
  return runFoundryCommand(
    [
      "cast",
      "run",
      options.txHash,
      "--rpc-url",
      options.rpcUrl,
      "--decode-internal",
      "--with-local-artifacts",
      "--trace-printer",
      "--color",
      "never",
    ],
    options,
  );
}

export async function runCastCode(options: CastCodeOptions): Promise<FoundryCommandResult> {
  return runFoundryCommand(["cast", "code", options.address, "--rpc-url", options.rpcUrl], options);
}

export async function runCastNonce(options: CastNonceOptions): Promise<FoundryCommandResult> {
  return runFoundryCommand(["cast", "nonce", options.address, "--rpc-url", options.rpcUrl], options);
}

export async function runCastGasPrice(options: CastRpcOptions): Promise<FoundryCommandResult> {
  return runFoundryCommand(["cast", "gas-price", "--rpc-url", options.rpcUrl], options);
}

export async function runCastCalldata(options: CastCalldataOptions): Promise<FoundryCommandResult> {
  return runFoundryCommand(["cast", "calldata", options.signature, ...options.args], options);
}

export async function runCastKeccak(options: CastKeccakOptions): Promise<FoundryCommandResult> {
  return runFoundryCommand(["cast", "keccak", options.value], options);
}

export async function runCastCall(options: CastCallOptions): Promise<FoundryCommandResult> {
  return runFoundryCommand(["cast", "call", options.address, options.signature, ...options.args, "--rpc-url", options.rpcUrl], options);
}

export async function runCastEstimate(options: CastEstimateOptions): Promise<FoundryCommandResult> {
  const command = ["cast", "estimate", options.address, options.signature, ...options.args, "--rpc-url", options.rpcUrl];
  pushOptionalFlag(command, "--from", options.from);
  pushOptionalFlag(command, "--value", options.value);
  return runFoundryCommand(command, options);
}

export async function runCastSend(options: CastSendOptions): Promise<FoundryCommandResult> {
  const command = [
    "cast",
    "send",
    options.address,
    options.signature,
    ...options.args,
    "--rpc-url",
    options.rpcUrl,
  ];
  command.push(...walletArgs(options.wallet));
  pushOptionalFlag(command, "--value", options.value);
  pushOptionalFlag(command, "--gas-limit", options.gasLimit);
  return runFoundryCommand(command, withWalletEnv(options));
}

export async function runCastDecodeAbi(options: CastDecodeAbiOptions): Promise<FoundryCommandResult> {
  return runFoundryCommand(["cast", "decode-abi", options.signature, options.data], options);
}

export async function runCastLogs(options: CastLogsOptions): Promise<FoundryCommandResult> {
  return runFoundryCommand(
    [
      "cast",
      "logs",
      "--json",
      "--address",
      options.address,
      "--from-block",
      "0",
      "--to-block",
      "latest",
      "--rpc-url",
      options.rpcUrl,
    ],
    options,
  );
}

export async function runCastSigEvent(options: CastSigEventOptions): Promise<FoundryCommandResult> {
  return runFoundryCommand(["cast", "sig-event", options.signature], options);
}

export async function runCastBalance(options: CastBalanceOptions): Promise<FoundryCommandResult> {
  return runFoundryCommand(["cast", "balance", options.selector, "--rpc-url", options.rpcUrl], options);
}

function pushOptionalFlag(command: string[], flag: string, value: string | undefined): void {
  if (value !== undefined) {
    command.push(flag, value);
  }
}

function withWalletEnv<T extends FoundryCommandOptions & { readonly wallet: FoundryWallet }>(options: T): T {
  if (options.wallet.kind !== "private-key-env") {
    return options;
  }

  return {
    ...options,
    env: {
      ...options.env,
      ETH_PRIVATE_KEY: options.wallet.privateKey,
    },
  };
}

function walletArgs(wallet: FoundryWallet): readonly string[] {
  switch (wallet.kind) {
    case "unlocked":
      return ["--unlocked", "--from", wallet.from];
    case "private-key-env":
      return [];
  }
}

function constructorArgsFlag(args: readonly string[]): readonly string[] {
  return args.length === 0 ? [] : ["--constructor-args", ...args];
}

function valueFlag(value: string | undefined): readonly string[] {
  return value === undefined ? [] : ["--value", value];
}

function gasLimitFlag(value: string | undefined): readonly string[] {
  return value === undefined ? [] : ["--gas-limit", value];
}
