import {
  activeNetworkRuntime,
  ProjectError,
  readContractArtifact,
  resolveArtifactPath,
  resolveTarget,
} from "@consol/core";
import type { ContractArtifact } from "@consol/core";
import { runCastCode, runForgeBuild, runForgeCreate } from "@consol/foundry";
import type { AccountMeta, NetworkMeta } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv } from "../main";
import { contractIdentifier } from "./contract-id";
import {
  argsHash,
  deploymentCacheKey,
  deploymentEntry,
  readDeploymentCache,
  writeDeploymentCache,
} from "./deploy-cache";
import { fetchReceiptSummary, recordDeployHistory } from "./deploy-history";
import type { DeployOptions } from "./deploy-options";
import type { ReceiptSummary } from "./transaction-history";
import { writePreviewDetails } from "./write-preview";
import { resolveWriteSigner } from "./write-signer";

export type DeployData = {
  readonly contract: string;
  readonly address: string;
  readonly tx_hash: string | null;
  readonly receipt: ReceiptSummary | null;
  readonly history_path: string | null;
  readonly history_error: string | null;
  readonly signer_address: string | null;
  readonly nonce: string | null;
  readonly gas_price: string | null;
  readonly cached: boolean;
  readonly bytecode_hash: string;
  readonly constructor_args_hash: string;
  readonly network: string;
  readonly chain_id: number | null;
};

export type RunDeployCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
};

export async function executeDeployment(
  input: RunDeployCommandInput,
  options: DeployOptions,
): Promise<{
  readonly data: DeployData;
  readonly network: NetworkMeta;
  readonly account: AccountMeta;
  readonly projectRoot: string;
}> {
  const resolved = resolveTarget({
    cwd: input.cwd,
    target: options.target,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  const network = activeNetworkRuntime(input.env);
  if (network.meta.write_policy !== "local") {
    throw new ProjectError({
      code: "deploy_remote_not_supported",
      message: `Deploy is not enabled for ${network.meta.name} yet.`,
      hint: "Use the local profile while the TS rewrite wires remote write confirmation.",
    });
  }
  if (options.skipBuild !== true) {
    const build = await runForgeBuild({
      cwd: resolved.projectRoot,
      projectRoot: resolved.projectRoot,
      env: input.env,
    });
    if (!build.ok) {
      throw new ProjectError({
        code: "foundry_build_failed",
        message: "Foundry build failed before deploy.",
        hint: build.stderr.trim() || build.stdout.trim() || build.error,
      });
    }
  }

  const artifact = readContractArtifact(resolveArtifactPath(resolved));
  const bytecodeHash = requiredBytecodeHash(artifact);
  const constructorArgsHash = argsHash(options.constructorArgs);
  const deploymentValue = options.value ?? null;
  const signer = resolveWriteSigner({ globals: input.globals, env: input.env });
  const account = signer.account;

  const cache = readDeploymentCache(resolved.projectRoot);
  const cacheKey = deploymentCacheKey({
    resolved,
    bytecodeHash,
    constructorArgsHash,
    value: deploymentValue,
    networkName: network.meta.fingerprint ?? network.meta.name,
    deployer: account.address ?? account.name,
  });
  const cached = options.fresh ? null : deploymentEntry(cache.entries[cacheKey]);
  if (cached !== null) {
    const code = await runCastCode({
      cwd: resolved.projectRoot,
      env: input.env,
      rpcUrl: network.rpc_url,
      address: cached.address,
    });
    if (code.ok && hasCode(code.stdout)) {
      return {
        data: {
          contract: resolved.contractName,
          address: cached.address,
          tx_hash: cached.deploy_tx,
          receipt: null,
          history_path: null,
          history_error: null,
          signer_address: null,
          nonce: null,
          gas_price: null,
          cached: true,
          bytecode_hash: bytecodeHash,
          constructor_args_hash: constructorArgsHash,
          network: network.meta.name,
          chain_id: network.meta.chain_id,
        },
        network: network.meta,
        account,
        projectRoot: resolved.projectRoot,
      };
    }
  }

  const preview = await writePreviewDetails({
    env: input.env,
    projectRoot: resolved.projectRoot,
    rpcUrl: network.rpc_url,
    signerAddress: account.address,
  });
  const created = await runForgeCreate({
    cwd: resolved.projectRoot,
    projectRoot: resolved.projectRoot,
    env: input.env,
    contractId: contractIdentifier(resolved, artifact),
    rpcUrl: network.rpc_url,
    privateKey: signer.privateKey,
    constructorArgs: options.constructorArgs,
    ...(options.value === undefined ? {} : { value: options.value }),
    ...(options.gasLimit === undefined ? {} : { gasLimit: options.gasLimit }),
  });
  if (!created.ok) {
    throw new ProjectError({
      code: "forge_create_failed",
      message: "forge create failed before deployment was recorded.",
      hint: created.stderr.trim() || created.stdout.trim() || created.error,
    });
  }

  const address = parseRequiredCreateField(created.stdout, /^Deployed to:\s*(\S+)$/m, "deployment_address_missing");
  const txHash = parseOptionalCreateField(created.stdout, /^Transaction hash:\s*(\S+)$/m);
  const receipt =
    txHash === null
      ? null
      : await fetchReceiptSummary({
          env: input.env,
          projectRoot: resolved.projectRoot,
          rpcUrl: network.rpc_url,
          txHash,
        });
  const deployedAtUnix = Math.floor(Date.now() / 1000);
  const entry = {
    contract: resolved.contractName,
    address,
    chain_id: network.meta.chain_id,
    network: network.meta.name,
    network_fingerprint: network.meta.fingerprint,
    deployer: account.address ?? account.name,
    bytecode_hash: bytecodeHash,
    constructor_args_hash: constructorArgsHash,
    deployment_value: deploymentValue,
    deploy_tx: txHash,
    deployed_at_unix: deployedAtUnix,
  };
  const entryKey = options.fresh ? uniqueDeploymentCacheKey(cache.entries, cacheKey) : cacheKey;
  writeDeploymentCache(resolved.projectRoot, {
    version: cache.version,
    entries: {
      ...cache.entries,
      [entryKey]: entry,
    },
  });

  const { historyPath, historyError } =
    txHash === null
      ? { historyPath: null, historyError: null }
      : recordDeployHistory({
          projectRoot: resolved.projectRoot,
          contract: resolved.contractName,
          target: options.target,
          address,
          txHash,
          receipt,
          network: network.meta,
          account,
          signerAddress: account.address,
          nonce: preview.nonce,
          gasPrice: preview.gasPrice,
        });

  return {
    data: {
      contract: resolved.contractName,
      address,
      tx_hash: txHash,
      receipt,
      history_path: historyPath,
      history_error: historyError,
      signer_address: account.address,
      nonce: preview.nonce,
      gas_price: preview.gasPrice,
      cached: false,
      bytecode_hash: bytecodeHash,
      constructor_args_hash: constructorArgsHash,
      network: network.meta.name,
      chain_id: network.meta.chain_id,
    },
    network: network.meta,
    account,
    projectRoot: resolved.projectRoot,
  };
}

function requiredBytecodeHash(artifact: ContractArtifact): string {
  if (artifact.bytecodeHash === null) {
    throw new ProjectError({
      code: "artifact_missing_bytecode",
      message: "Artifact has no deployable bytecode.",
      hint: "Run `consol build` and check that the target is a deployable contract.",
    });
  }
  return artifact.bytecodeHash;
}

function parseRequiredCreateField(stdout: string, pattern: RegExp, code: string): string {
  const value = parseOptionalCreateField(stdout, pattern);
  if (value !== null) {
    return value;
  }

  throw new ProjectError({
    code,
    message: "forge create output did not include the deployed address.",
    hint: "Re-run forge create directly to inspect the raw deployment output.",
  });
}

function parseOptionalCreateField(stdout: string, pattern: RegExp): string | null {
  const match = pattern.exec(stdout);
  const value = match?.[1];
  return value === undefined ? null : value;
}

function hasCode(value: string): boolean {
  const code = value.trim();
  return code.length > 0 && code !== "0x";
}

function uniqueDeploymentCacheKey(entries: Record<string, unknown>, baseKey: string): string {
  if (entries[baseKey] === undefined) {
    return baseKey;
  }

  let index = 2;
  while (entries[`${baseKey}:fresh:${index}`] !== undefined) {
    index += 1;
  }
  return `${baseKey}:fresh:${index}`;
}
