import { runCastCalldata, runCastGasPrice, runCastKeccak, runCastNonce } from "@consol/foundry";
import type { CliEnv } from "../main";

export type WritePreviewDetails = {
  readonly nonce: string | null;
  readonly gasPrice: string | null;
  readonly calldataHash: string | null;
  readonly calldataPrefix: string | null;
};

export async function writePreviewDetails(input: {
  readonly env: CliEnv;
  readonly projectRoot: string;
  readonly rpcUrl: string;
  readonly signerAddress: string | null;
  readonly calldata?: {
    readonly signature: string;
    readonly args: readonly string[];
  };
}): Promise<WritePreviewDetails> {
  const calldata =
    input.calldata === undefined
      ? null
      : await optionalCastOutput(
          runCastCalldata({
            cwd: input.projectRoot,
            env: input.env,
            signature: input.calldata.signature,
            args: input.calldata.args,
          }),
        );
  const nonce =
    input.signerAddress === null
      ? null
      : await optionalCastOutput(
          runCastNonce({
            cwd: input.projectRoot,
            env: input.env,
            rpcUrl: input.rpcUrl,
            address: input.signerAddress,
          }),
        );
  const gasPrice = await optionalCastOutput(
    runCastGasPrice({
      cwd: input.projectRoot,
      env: input.env,
      rpcUrl: input.rpcUrl,
    }),
  );
  const calldataHash =
    calldata === null
      ? null
      : await optionalCastOutput(
          runCastKeccak({
            cwd: input.projectRoot,
            env: input.env,
            value: calldata,
          }),
        );

  return {
    nonce,
    gasPrice,
    calldataHash,
    calldataPrefix: calldata === null ? null : calldataPrefix(calldata),
  };
}

async function optionalCastOutput(result: Promise<{ readonly ok: boolean; readonly stdout: string }>): Promise<string | null> {
  const output = await result;
  if (!output.ok) {
    return null;
  }
  const value = output.stdout.trim();
  return value.length === 0 ? null : value;
}

function calldataPrefix(calldata: string): string {
  return calldata.length <= 42 ? calldata : `${calldata.slice(0, 42)}...`;
}
