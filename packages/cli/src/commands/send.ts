import { activeNetworkMeta, ProjectError, type ResolvedTarget } from "@consol/core";
import { runCastEstimate, runCastReceipt, runCastSend } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import { createReadContext } from "./interact-context";
import { resolveFunctionSignature } from "./interact";
import { sendLifecycleNdjson } from "./send-ndjson";
import { parseSendOptions } from "./send-options";
import { writePreviewDetails } from "./write-preview";
import { receiptSummaryFromValue, recordSend, type ReceiptSummary } from "./transaction-history";
import { resolveWriteSigner } from "./write-signer";

export type RunSendCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
  readonly ensureArtifact?: (resolved: ResolvedTarget) => Promise<void>;
};

export type SendData = {
  readonly contract: string;
  readonly address: string;
  readonly function: string;
  readonly signature: string;
  readonly tx_output: string;
  readonly tx_hash: string | null;
  readonly receipt: ReceiptSummary | null;
  readonly history_path: string | null;
  readonly history_error: string | null;
  readonly signer_address: string | null;
  readonly nonce: string | null;
  readonly gas_price: string | null;
  readonly calldata_hash: string | null;
  readonly calldata_prefix: string | null;
  readonly gas: GasSignal;
  readonly gas_estimate: string | null;
  readonly gas_estimate_error: string | null;
};

type GasSignal = {
  readonly kind: "rpc_estimate";
  readonly source: "cast estimate";
  readonly confidence: "medium" | "none";
  readonly context: {
    readonly target: string;
    readonly contract: string;
    readonly address: string;
    readonly function: string;
    readonly network: string;
    readonly chain_id: number | null;
    readonly from?: string;
    readonly value?: string;
  };
  readonly estimate: string | null;
  readonly error: string | null;
};

export async function runSendCommand(input: RunSendCommandInput): Promise<CliResult> {
  const options = parseSendOptions(input.commandArgs);
  const activeNetwork = activeNetworkMeta(input.env);
  if (activeNetwork.write_policy !== "local") {
    throw new ProjectError({
      code: "remote_confirmation_required",
      message: `Remote writes on ${activeNetwork.name} require typed confirmation.`,
      hint: "Use the local profile while the TS rewrite wires remote write confirmation.",
    });
  }
  const context = await createReadContext({
    globals: input.globals,
    cwd: input.cwd,
    env: input.env,
    target: options.target,
    ...(options.address === undefined ? {} : { addressOverride: options.address }),
    ...(input.ensureArtifact === undefined ? {} : { ensureArtifact: input.ensureArtifact }),
  });

  const signature = resolveFunctionSignature(context.artifact.abi, options.functionName, true);
  const signer = resolveWriteSigner({ globals: input.globals, env: input.env });
  const signerAddress = context.account.address;
  const address = options.address ?? context.address;
  const preview = await writePreviewDetails({
    env: input.env,
    projectRoot: context.resolved.projectRoot,
    rpcUrl: context.network.rpc_url,
    signerAddress,
    calldata: {
      signature,
      args: options.args,
    },
  });
  const gas = await estimateGas({
    input,
    target: options.target,
    contract: context.resolved.contractName,
    address,
    projectRoot: context.resolved.projectRoot,
    signature,
    args: options.args,
    rpcUrl: context.network.rpc_url,
    network: context.network.name,
    chainId: context.network.chain_id,
    from: signerAddress,
    ...(options.value === undefined ? {} : { value: options.value }),
  });
  const sent = await runCastSend({
    cwd: context.resolved.projectRoot,
    env: input.env,
    rpcUrl: context.network.rpc_url,
    address,
    signature,
    args: options.args,
    privateKey: signer.privateKey,
    ...(options.value === undefined ? {} : { value: options.value }),
    ...(options.gasLimit === undefined ? {} : { gasLimit: options.gasLimit }),
  });
  if (!sent.ok) {
    throw new ProjectError({
      code: "send_failed",
      message: `cast send failed for ${signature}.`,
      hint: sent.stderr.trim() || sent.stdout.trim() || sent.error,
    });
  }

  const txOutput = sent.stdout.trim();
  const txHash = parseTransactionHash(txOutput);
  const receipt = txHash === null ? null : await fetchReceipt(input, context.resolved.projectRoot, context.network.rpc_url, txHash);
  let historyPath: string | null = null;
  let historyError: string | null = null;
  if (txHash !== null) {
    try {
      historyPath = recordSend({
        projectRoot: context.resolved.projectRoot,
        contract: context.resolved.contractName,
        target: options.target,
        address,
        functionName: options.functionName,
        signature,
        args: options.args,
        value: options.value ?? null,
        gasEstimate: gas.estimate,
        gasEstimateError: gas.error,
        txHash,
        receipt,
        network: context.network,
        account: context.account,
        signerAddress,
        nonce: preview.nonce,
        gasPrice: preview.gasPrice,
        calldataHash: preview.calldataHash,
        calldataPrefix: preview.calldataPrefix,
      });
    } catch (error) {
      historyError = error instanceof Error ? error.message : String(error);
    }
  }

  const data: SendData = {
    contract: context.resolved.contractName,
    address,
    function: options.functionName,
    signature,
    tx_output: txOutput,
    tx_hash: txHash,
    receipt,
    history_path: historyPath,
    history_error: historyError,
    signer_address: signerAddress,
    nonce: preview.nonce,
    gas_price: preview.gasPrice,
    calldata_hash: preview.calldataHash,
    calldata_prefix: preview.calldataPrefix,
    gas,
    gas_estimate: gas.estimate,
    gas_estimate_error: gas.error,
  };

  if (input.globals.ndjson) {
    return {
      exitCode: 0,
      stdout: sendLifecycleNdjson({
        data,
        target: options.target,
        value: options.value ?? null,
        network: context.network,
        account: context.account,
      }),
      stderr: "",
    };
  }
  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "send",
        network: context.network,
        account: context.account,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `${data.contract} ${data.signature} -> ${data.tx_hash ?? "submitted"}\n`, stderr: "" };
}

async function estimateGas(input: {
  readonly input: RunSendCommandInput;
  readonly target: string;
  readonly contract: string;
  readonly address: string;
  readonly projectRoot: string;
  readonly signature: string;
  readonly args: readonly string[];
  readonly rpcUrl: string;
  readonly network: string;
  readonly chainId: number | null;
  readonly from: string | null;
  readonly value?: string;
}): Promise<GasSignal> {
  const result = await runCastEstimate({
    cwd: input.projectRoot,
    env: input.input.env,
    rpcUrl: input.rpcUrl,
    address: input.address,
    signature: input.signature,
    args: input.args,
    ...(input.from === null ? {} : { from: input.from }),
    ...(input.value === undefined ? {} : { value: input.value }),
  });
  const estimate = result.ok ? result.stdout.trim() : null;
  return {
    kind: "rpc_estimate",
    source: "cast estimate",
    confidence: result.ok ? "medium" : "none",
    context: {
      target: input.target,
      contract: input.contract,
      address: input.address,
      function: input.signature,
      network: input.network,
      chain_id: input.chainId,
      ...(input.from === null ? {} : { from: input.from }),
      ...(input.value === undefined ? {} : { value: input.value }),
    },
    estimate,
    error: result.ok ? null : result.stderr.trim() || result.stdout.trim() || result.error,
  };
}

async function fetchReceipt(
  input: RunSendCommandInput,
  projectRoot: string,
  rpcUrl: string,
  txHash: string,
): Promise<ReceiptSummary | null> {
  const receipt = await runCastReceipt({
    cwd: projectRoot,
    env: input.env,
    rpcUrl,
    txHash,
  });
  if (!receipt.ok) {
    return null;
  }

  try {
    return receiptSummaryFromValue(JSON.parse(receipt.stdout) as unknown);
  } catch {
    return null;
  }
}

function parseTransactionHash(output: string): string | null {
  return lineValue(output, "transactionHash") ?? lineValue(output, "Transaction hash:");
}

function lineValue(output: string, prefix: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(prefix)) {
      continue;
    }

    const value = trimmed.slice(prefix.length).trim().replace(/^:/, "").trim();
    if (value.length > 0) {
      return value;
    }
  }

  return null;
}
