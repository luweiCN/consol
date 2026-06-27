import {
  ProjectError,
  readContractArtifact,
  resolveArtifactPath,
  resolveTarget,
} from "@consol/core";
import type { ContractArtifact, LibraryRequirement, ResolvedTarget } from "@consol/core";
import { runCastCode, runForgeBuild, runForgeCreate } from "@consol/foundry";
import type { ForgeLibrary } from "@consol/foundry";
import type { AccountMeta, NetworkMeta } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv } from "../main";
import { contractIdentifier } from "./contract-id";
import {
  argsHash,
  deploymentCacheKey,
  deploymentEntry,
  libraryDeploymentCacheKey,
  readDeploymentCache,
  writeDeploymentCache,
} from "./deploy-cache";
import { fetchReceiptSummary, recordDeployHistory } from "./deploy-history";
import type { DeployOptions } from "./deploy-options";
import type { ReceiptSummary } from "./transaction-history";
import { writePreviewDetails } from "./write-preview";
import { foundryWalletForNetwork, resolveWriteSigner } from "./write-signer";
import { resolveCliWriteNetworkRuntime } from "./network-runtime";
import { isLibraryTarget, parseLibraryOverrides, resolveLibraries } from "./deploy-libraries";
import { join } from "node:path";

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
  const network = await resolveCliWriteNetworkRuntime({ globals: input.globals, cwd: resolved.projectRoot, env: input.env });
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
  const isLibrary = isLibraryTarget(resolved);
  const networkName = network.meta.fingerprint ?? network.meta.name;

  const cache = readDeploymentCache(resolved.projectRoot);
  const cacheKey = isLibrary
    ? libraryDeploymentCacheKey({
        source: contractIdentifier(resolved, artifact).split(":")[0] ?? "",
        name: resolved.contractName,
        networkName,
        bytecodeHash,
      })
    : deploymentCacheKey({
        resolved,
        bytecodeHash,
        constructorArgsHash,
        value: deploymentValue,
        networkName,
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

  const userLibraries = parseLibraryOverrides(options.libraries);
  const libraryLinks = await resolveLibraries(artifact, userLibraries, {
    loadArtifact: (req) =>
      readContractArtifact(
        resolveArtifactPath({
          sourceMode: "project",
          projectRoot: resolved.projectRoot,
          sourceFile: join(resolved.projectRoot, req.source),
          contractName: req.name,
        }),
      ),
    resolveCached: async (req, libBytecodeHash) => {
      const libCache = readDeploymentCache(resolved.projectRoot);
      const key = libraryDeploymentCacheKey({
        source: req.source,
        name: req.name,
        networkName: network.meta.fingerprint ?? network.meta.name,
        bytecodeHash: libBytecodeHash,
      });
      const entry = deploymentEntry(libCache.entries[key]);
      if (entry === null) {
        return null;
      }
      const code = await runCastCode({
        cwd: resolved.projectRoot,
        env: input.env,
        rpcUrl: network.rpc_url,
        address: entry.address,
      });
      return code.ok && hasCode(code.stdout) ? entry.address : null;
    },
    deploy: (req, libArtifact, libraries) =>
      deployLibrary({ req, libArtifact, libraries, input, resolved, network, signer }),
  });

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
    wallet: foundryWalletForNetwork(signer, network.meta),
    constructorArgs: options.constructorArgs,
    libraries: libraryLinks,
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
    kind: isLibrary ? ("library" as const) : ("contract" as const),
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

async function deployLibrary(args: {
  readonly req: LibraryRequirement;
  readonly libArtifact: ContractArtifact;
  readonly libraries: readonly ForgeLibrary[];
  readonly input: RunDeployCommandInput;
  readonly resolved: ResolvedTarget;
  readonly network: { readonly meta: NetworkMeta; readonly rpc_url: string };
  readonly signer: ReturnType<typeof resolveWriteSigner>;
}): Promise<string> {
  const created = await runForgeCreate({
    cwd: args.resolved.projectRoot,
    projectRoot: args.resolved.projectRoot,
    env: args.input.env,
    contractId: `${args.req.source}:${args.req.name}`,
    rpcUrl: args.network.rpc_url,
    wallet: foundryWalletForNetwork(args.signer, args.network.meta),
    constructorArgs: [],
    libraries: args.libraries,
  });
  if (!created.ok) {
    throw new ProjectError({
      code: "forge_create_failed",
      message: `forge create failed while deploying library ${args.req.name}.`,
      hint: created.stderr.trim() || created.stdout.trim() || created.error,
    });
  }
  const address = parseRequiredCreateField(created.stdout, /^Deployed to:\s*(\S+)$/m, "deployment_address_missing");
  const bytecodeHash = args.libArtifact.bytecodeHash ?? "";
  const key = libraryDeploymentCacheKey({
    source: args.req.source,
    name: args.req.name,
    networkName: args.network.meta.fingerprint ?? args.network.meta.name,
    bytecodeHash,
  });
  const cache = readDeploymentCache(args.resolved.projectRoot);
  writeDeploymentCache(args.resolved.projectRoot, {
    version: cache.version,
    entries: {
      ...cache.entries,
      [key]: {
        kind: "library",
        contract: args.req.name,
        address,
        chain_id: args.network.meta.chain_id,
        network: args.network.meta.name,
        network_fingerprint: args.network.meta.fingerprint,
        deployer: args.signer.account.address ?? args.signer.account.name,
        bytecode_hash: bytecodeHash,
        constructor_args_hash: argsHash([]),
        deployment_value: null,
        deploy_tx: parseOptionalCreateField(created.stdout, /^Transaction hash:\s*(\S+)$/m),
        deployed_at_unix: Math.floor(Date.now() / 1000),
      },
    },
  });
  return address;
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
