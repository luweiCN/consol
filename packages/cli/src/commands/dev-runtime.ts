import { activeNetworkRuntime, networkMetaFromProfile, networkProfiles, ProjectError } from "@consol/core";
import {
  createRpcAdapter as createDefaultRpcAdapter,
  type CreateRpcAdapterInput,
  type RpcAdapter,
  type RpcNetworkKind,
} from "@consol/rpc";
import type { NetworkMeta } from "@consol/protocol";
import type { CliEnv } from "../main";

export type CreateDevRpcAdapter = (input: CreateRpcAdapterInput & { readonly network: NetworkMeta }) => RpcAdapter;

// Network-runtime helpers only need the environment and optional RPC adapter
// factory, so they accept this narrowed shape that `RunDevCommandInput`
// structurally satisfies.
export type DevRuntimeInput = {
  readonly env: CliEnv;
  readonly createRpcAdapter?: CreateDevRpcAdapter;
};

export function networkRuntimeForSelection(
  input: DevRuntimeInput,
  networkName: string,
): { readonly meta: NetworkMeta; readonly rpcUrl: string } {
  const profile = networkProfiles(input.env)[networkName];
  if (profile === undefined) {
    throw new ProjectError({
      code: "network_not_found",
      message: `Network profile \`${networkName}\` does not exist.`,
      hint: "Run `consol network list` or select another network.",
    });
  }

  const rpcUrl = profile.rpc_url ?? envValue(input.env, profile.rpc_url_env);
  if (rpcUrl === undefined) {
    throw new ProjectError({
      code: "network_rpc_missing",
      message: `Network profile \`${networkName}\` requires an RPC URL.`,
      hint: "Set the configured RPC environment variable or update the network profile.",
    });
  }

  return {
    meta: networkMetaFromProfile(networkName, profile, input.env) ?? activeNetworkRuntime(input.env).meta,
    rpcUrl,
  };
}

export function rpcAdapterForRuntime(
  input: DevRuntimeInput,
  runtime: { readonly meta: NetworkMeta; readonly rpcUrl: string },
): RpcAdapter {
  const factory = input.createRpcAdapter ?? ((adapterInput: CreateRpcAdapterInput & { readonly network: NetworkMeta }) => createDefaultRpcAdapter(adapterInput));
  return factory({
    rpcUrl: runtime.rpcUrl,
    networkKind: rpcNetworkKind(runtime.meta),
    network: runtime.meta,
  });
}

export function rpcAdapterForNetwork(input: DevRuntimeInput, network: NetworkMeta): RpcAdapter {
  return rpcAdapterForRuntime(input, { meta: network, rpcUrl: network.rpc_url });
}

function rpcNetworkKind(network: NetworkMeta): RpcNetworkKind {
  return network.kind === "anvil" || network.kind === "local" ? "local" : "remote";
}

function envValue(env: CliEnv, name: string | undefined): string | undefined {
  if (name === undefined) {
    return undefined;
  }

  const value = env[name]?.trim();
  return value === "" ? undefined : value;
}
