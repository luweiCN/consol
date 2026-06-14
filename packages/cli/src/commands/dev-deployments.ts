import { formatEther } from "viem";
import {
  activeNetworkRuntime,
  createDevSessionFromResolved,
  listScratchProjectRoots,
  resolveDevSession,
  singleFileScratchRoot,
  type DevSession,
} from "@consol/core";
import { runCastBalance, runCastCode } from "@consol/foundry";
import type { NetworkMeta } from "@consol/protocol";
import type { DevDeployedContract } from "@consol/tui";
import { mapLimit } from "../concurrency";
import { deploymentEntries, deploymentEntryMatchesNetwork, pruneMissingDeploymentEntries, type DeployListItem } from "./deploy-cache";
import { networkRuntimeForSelection, type DevRuntimeInput } from "./dev-runtime";

type DeploymentRuntime = { readonly meta: NetworkMeta; readonly rpcUrl: string };

type DeploymentCandidate = { readonly projectRoot: string; readonly entry: DeployListItem };

// Bounds `cast code` subprocess fan-out: aggregating every scratch root can
// surface hundreds of recorded deployments on a shared local chain, and each
// liveness check spawns one cast process.
const DEPLOYMENT_CODE_CHECK_CONCURRENCY = 16;

// Deployments are cached per project root. In single-file mode each .sol file
// gets its own scratch project root, so the active session's root only holds
// the current file's deployments. Aggregate every scratch root (plus the
// active root) so the deployed-contract picker shows every contract recorded
// on the selected network, regardless of which file deployed it.
export async function createDevDeployedContractsSnapshot(
  input: DevRuntimeInput,
  session: DevSession,
  networkName?: string,
): Promise<readonly DevDeployedContract[]> {
  const runtime = deploymentSnapshotRuntime(input, networkName);
  const localRuntime = isLocalDeploymentRuntime(runtime.meta);

  // The active root is pruned (and its cache rewritten) so it stays tidy.
  const activeEntries = await activeRootDeployments(input, session.projectRoot, runtime, localRuntime);
  // Scratch roots only exist in single-file mode; project mode keeps every
  // deployment under its single project root. Read-only here; verify on-chain
  // liveness with bounded concurrency.
  const otherCandidates =
    session.sourceMode === "single_file" ? otherScratchDeployments(session.projectRoot, runtime) : [];
  const otherLive = await mapLimit(
    otherCandidates,
    DEPLOYMENT_CODE_CHECK_CONCURRENCY,
    ({ projectRoot, entry }) => deploymentEntryHasCode(input, projectRoot, entry, runtime.rpcUrl),
  );

  const contracts: DevDeployedContract[] = [];
  for (const entry of activeEntries) {
    appendDeployedContract(contracts, session, entry, session.projectRoot);
  }
  otherCandidates.forEach((candidate, index) => {
    if (otherLive[index]) {
      appendDeployedContract(contracts, session, candidate.entry, candidate.projectRoot);
    }
  });

  // Surface each contract's ETH balance so identical redeploys are
  // distinguishable in the picker (which instance actually holds funds).
  const balances = await mapLimit(contracts, DEPLOYMENT_CODE_CHECK_CONCURRENCY, (contract) =>
    contractBalanceDisplay(input, session.projectRoot, contract.address, runtime.rpcUrl),
  );
  return contracts.map((contract, index) => {
    const display = balances[index];
    return display === null || display === undefined ? contract : { ...contract, balanceDisplay: display };
  });
}

async function contractBalanceDisplay(
  input: DevRuntimeInput,
  projectRoot: string,
  address: string,
  rpcUrl: string,
): Promise<string | null> {
  const result = await runCastBalance({ cwd: projectRoot, env: input.env, selector: address, rpcUrl });
  if (!result.ok) {
    return null;
  }
  const wei = result.stdout.trim();
  return /^[0-9]+$/.test(wei) ? `${formatEther(BigInt(wei))} ETH` : null;
}

function appendDeployedContract(
  contracts: DevDeployedContract[],
  session: DevSession,
  entry: DeployListItem,
  projectRoot: string,
): void {
  const contractSession = devSessionForDeployment(session, entry, projectRoot);
  if (contractSession !== null) {
    contracts.push(deployedContractFromCacheEntry(contractSession, entry));
  }
}

async function activeRootDeployments(
  input: DevRuntimeInput,
  projectRoot: string,
  runtime: DeploymentRuntime,
  localRuntime: boolean,
): Promise<readonly DeployListItem[]> {
  if (localRuntime) {
    return pruneMissingDeploymentEntries(projectRoot, {
      matches: (entry) => deploymentEntryMatchesNetwork(entry, runtime.meta),
      hasCode: async (entry) => await deploymentEntryHasCode(input, projectRoot, entry, runtime.rpcUrl),
    });
  }
  const matched = deploymentEntries(projectRoot).filter((entry) =>
    deploymentEntryMatchesNetwork(entry, runtime.meta),
  );
  const checks = await mapLimit(matched, DEPLOYMENT_CODE_CHECK_CONCURRENCY, (entry) =>
    deploymentEntryHasCode(input, projectRoot, entry, runtime.rpcUrl),
  );
  return matched.filter((_, index) => checks[index]);
}

function otherScratchDeployments(
  activeProjectRoot: string,
  runtime: DeploymentRuntime,
): readonly DeploymentCandidate[] {
  const candidates: DeploymentCandidate[] = [];
  for (const projectRoot of listScratchProjectRoots(singleFileScratchRoot())) {
    if (projectRoot === activeProjectRoot) {
      continue;
    }
    for (const entry of deploymentEntries(projectRoot)) {
      if (deploymentEntryMatchesNetwork(entry, runtime.meta)) {
        candidates.push({ projectRoot, entry });
      }
    }
  }
  return candidates;
}

function isLocalDeploymentRuntime(network: NetworkMeta): boolean {
  return network.kind === "anvil" || network.kind === "anvil-fork" || network.kind === "local";
}

function deploymentSnapshotRuntime(
  input: DevRuntimeInput,
  networkName: string | undefined,
): { readonly meta: NetworkMeta; readonly rpcUrl: string } {
  if (networkName !== undefined) {
    return networkRuntimeForSelection(input, networkName);
  }

  const runtime = activeNetworkRuntime(input.env);
  return { meta: runtime.meta, rpcUrl: runtime.rpc_url };
}

async function deploymentEntryHasCode(
  input: DevRuntimeInput,
  projectRoot: string,
  entry: DeployListItem,
  rpcUrl: string,
): Promise<boolean> {
  const code = await runCastCode({
    cwd: projectRoot,
    env: input.env,
    rpcUrl,
    address: entry.address,
  });
  return code.ok && hasDeployedCode(code.stdout);
}

function hasDeployedCode(value: string): boolean {
  const code = value.trim();
  return code.length > 0 && code !== "0x";
}

export function devSessionForDeployment(
  session: DevSession,
  entry: DeployListItem,
  entryProjectRoot: string,
): DevSession | null {
  if (entryProjectRoot === session.projectRoot && entry.contract === session.contract) {
    return session;
  }

  try {
    const nextSession = createDevSessionFromResolved(resolveDevSession({
      cwd: entryProjectRoot,
      target: entry.contract,
      projectRoot: entryProjectRoot,
    }));
    return session.workspaceRoot === undefined ? nextSession : { ...nextSession, workspaceRoot: session.workspaceRoot };
  } catch {
    return null;
  }
}

function deployedContractFromCacheEntry(session: DevSession, entry: DeployListItem): DevDeployedContract {
  return {
    id: `${entry.network_fingerprint ?? entry.network}:${entry.chain_id ?? "-"}:${entry.contract}:${entry.address.toLowerCase()}:${entry.deploy_tx ?? entry.deployed_at_unix}`,
    contract: entry.contract,
    address: entry.address,
    target: session.target,
    projectRoot: session.projectRoot,
    ...(session.workspaceRoot === undefined ? {} : { workspaceRoot: session.workspaceRoot }),
    sourceFile: session.sourceFile,
    network: entry.network,
    chainId: entry.chain_id === null ? null : String(entry.chain_id),
    networkFingerprint: entry.network_fingerprint,
    account: entry.deployer,
    deployTxHash: entry.deploy_tx,
    status: "ready",
    constructorArgs: [],
    value: entry.deployment_value,
    abiSummary: session.abiSummary,
    constructor: session.constructor,
    functions: session.functions,
    createdAtUnix: entry.deployed_at_unix,
  };
}
