import { ProjectError } from "@consol/core";
import type { ContractArtifact, LibraryRequirement } from "@consol/core";
import { runForgeCreate } from "@consol/foundry";
import type { ForgeLibrary } from "@consol/foundry";
import type { NetworkMeta } from "@consol/protocol";
import type { CliEnv } from "../main";
import { argsHash, libraryDeploymentCacheKey, readDeploymentCache, writeDeploymentCache } from "./deploy-cache";
import { recordDeployHistory } from "./deploy-history";
import { parseOptionalCreateField, parseRequiredCreateField } from "./forge-create-output";
import { foundryWalletForNetwork, resolveWriteSigner } from "./write-signer";

export async function deployLibrary(args: {
  readonly req: LibraryRequirement;
  readonly libArtifact: ContractArtifact;
  readonly libraries: readonly ForgeLibrary[];
  readonly env: CliEnv;
  readonly projectRoot: string;
  readonly network: { readonly meta: NetworkMeta; readonly rpc_url: string };
  readonly signer: ReturnType<typeof resolveWriteSigner>;
}): Promise<string> {
  const created = await runForgeCreate({
    cwd: args.projectRoot,
    projectRoot: args.projectRoot,
    env: args.env,
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
  const txHash = parseOptionalCreateField(created.stdout, /^Transaction hash:\s*(\S+)$/m);
  const key = libraryDeploymentCacheKey({
    source: args.req.source,
    name: args.req.name,
    networkName: args.network.meta.fingerprint ?? args.network.meta.name,
    bytecodeHash,
  });
  const cache = readDeploymentCache(args.projectRoot);
  writeDeploymentCache(args.projectRoot, {
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
        deploy_tx: txHash,
        deployed_at_unix: Math.floor(Date.now() / 1000),
      },
    },
  });

  if (txHash !== null) {
    recordDeployHistory({
      projectRoot: args.projectRoot,
      kind: "library",
      contract: args.req.name,
      target: `${args.req.source}:${args.req.name}`,
      address,
      txHash,
      receipt: null,
      network: args.network.meta,
      account: args.signer.account,
      signerAddress: args.signer.account.address,
      nonce: null,
      gasPrice: null,
    });
  }

  return address;
}
