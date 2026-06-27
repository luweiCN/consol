import { decodeEventLog, readContractArtifact, type DevSession } from "@consol/core";
import type { NetworkMeta } from "@consol/protocol";
import type { DevContractEventRecord, DevDeployedContract, RunDevShellInput } from "@consol/tui";
import { createDevDeployedContractsSnapshot, devSessionForDeployment } from "./dev-deployments";
import { networkRuntimeForSelection, rpcAdapterForRuntime, type DevRuntimeInput } from "./dev-runtime";
import {
  arrayFromUnknown,
  nullableScalarStringFromUnknown,
  nullableStringFromUnknown,
  rawEventString,
  recordFromUnknown,
} from "./dev-unknown";

export function createDevBlockWatchHandler(input: DevRuntimeInput): NonNullable<RunDevShellInput["onBlockWatchStart"]> {
  return ({ session, selection }, callbacks) => {
    const runtime = networkRuntimeForSelection(input, selection.networkName);
    const adapter = rpcAdapterForRuntime(input, runtime);
    const stops: Array<() => void> = [];
    stops.push(adapter.watchBlockNumber((blockNumber) => {
      callbacks.onBlockNumber(String(blockNumber));
    }));

    let stopped = false;
    void createDevDeployedContractsSnapshot(input, session, selection.networkName).then((contracts) => {
      if (stopped) {
        return;
      }
      for (const contract of contracts.filter((item) => sameRuntimeNetwork(item, runtime.meta))) {
        const abi = deployedContractAbi(session, contract);
        if (abi === null) {
          continue;
        }
        stops.push(adapter.watchContractEvent({
          address: contract.address,
          abi,
          onLogs: (logs) => {
            const records = eventRecordsFromWatchLogs(logs, abi, contract);
            if (records.length > 0) {
              callbacks.onEvents(records);
            }
          },
        }));
      }
    }).catch(() => {
      // Account and state polling still run; stale deployment caches should not stop the block watcher.
    });

    return () => {
      stopped = true;
      for (const stop of stops.splice(0).reverse()) {
        stop();
      }
    };
  };
}

function sameRuntimeNetwork(contract: DevDeployedContract, network: NetworkMeta): boolean {
  const contractNetwork = contract.networkFingerprint ?? contract.network;
  const matchesNetwork = contractNetwork === network.fingerprint || contractNetwork === network.name;
  const matchesChain = contract.chainId === null || network.chain_id === null || contract.chainId === String(network.chain_id);
  return matchesNetwork && matchesChain;
}

function deployedContractAbi(
  session: DevSession,
  contract: DevDeployedContract,
): readonly unknown[] | null {
  const projectRoot = contract.projectRoot ?? session.projectRoot;
  const contractSession =
    contract.contract === session.contract && projectRoot === session.projectRoot
      ? session
      : devSessionForDeployment(
          session,
          {
            kind: "contract",
            contract: contract.contract,
            address: contract.address,
            chain_id: contract.chainId === null ? null : Number(contract.chainId),
            network: contract.network ?? "",
            network_fingerprint: contract.networkFingerprint ?? null,
            deployer: contract.account,
            bytecode_hash: "",
            constructor_args_hash: "",
            deployment_value: contract.value ?? null,
            deploy_tx: contract.deployTxHash ?? null,
            deployed_at_unix: contract.createdAtUnix,
          },
          projectRoot,
        );
  if (contractSession === null) {
    return null;
  }

  try {
    return readContractArtifact(contractSession.artifactPath).abi;
  } catch {
    return null;
  }
}

function eventRecordsFromWatchLogs(
  logs: readonly unknown[],
  abi: readonly unknown[],
  contract: DevDeployedContract,
): readonly DevContractEventRecord[] {
  const createdAtUnix = Math.floor(Date.now() / 1000);
  return arrayFromUnknown(logs).flatMap((log, index) => {
    const record = recordFromUnknown(log);
    const topics = arrayFromUnknown(record?.["topics"]).filter((topic): topic is string => typeof topic === "string");
    const data = nullableStringFromUnknown(record?.["data"]) ?? "0x";
    const decoded = decodeEventLog(abi, topics, data);
    if (decoded === null) {
      return [];
    }
    const txHash = nullableStringFromUnknown(record?.["transactionHash"] ?? record?.["transaction_hash"]);
    const logIndex = nullableScalarStringFromUnknown(record?.["logIndex"] ?? record?.["log_index"]) ?? String(index);
    return [
      {
        id: `${txHash ?? contract.address}:${logIndex}`,
        source: "watch" as const,
        contract: contract.contract,
        address: contract.address,
        event: decoded.eventName,
        signature: null,
        args: decoded.args.map((arg) => ({ name: arg.name, kind: arg.type, indexed: arg.indexed, value: arg.value })),
        raw: rawEventString(log),
        txHash,
        blockNumber: nullableScalarStringFromUnknown(record?.["blockNumber"] ?? record?.["block_number"]),
        logIndex,
        createdAtUnix,
      },
    ];
  });
}
