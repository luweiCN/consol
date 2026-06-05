import { ProjectError, resolveNetworkRuntime, type NetworkRuntime } from "@consol/core";
import { runCastChainId } from "@consol/foundry";
import type { GlobalArgs } from "../args";
import type { CliEnv } from "../main";

export function resolveCliNetworkRuntime(input: { readonly globals: GlobalArgs; readonly env: CliEnv }): NetworkRuntime {
  return resolveNetworkRuntime({
    env: input.env,
    ...(input.globals.network === undefined ? {} : { network: input.globals.network }),
    ...(input.globals.rpcUrl === undefined ? {} : { rpcUrl: input.globals.rpcUrl }),
    ...(input.globals.chainId === undefined ? {} : { chainId: input.globals.chainId }),
  });
}

export async function resolveCliWriteNetworkRuntime(input: {
  readonly globals: GlobalArgs;
  readonly cwd: string;
  readonly env: CliEnv;
}): Promise<NetworkRuntime> {
  const network = resolveCliNetworkRuntime(input);
  if (network.meta.write_policy === "local") {
    return network;
  }

  if (network.meta.write_policy === "read-only") {
    throw new ProjectError({
      code: "remote_write_read_only",
      message: `Writes are disabled for ${network.meta.name}.`,
      hint: "Select a network profile with a write policy that allows writes.",
    });
  }

  if (input.globals.yes) {
    throw remoteConfirmationRequired(network.meta.name);
  }

  if (input.globals.confirmNetwork === undefined) {
    throw remoteConfirmationRequired(network.meta.name);
  }

  if (network.source !== "profile") {
    throw new ProjectError({
      code: "confirm_network_requires_named_network",
      message: "`--confirm-network` can only approve a named network profile.",
      hint: "Use `consol network add` and `consol network use`, then pass the exact profile name.",
    });
  }

  if (input.globals.confirmNetwork !== network.meta.name) {
    throw new ProjectError({
      code: "confirm_network_mismatch",
      message: `Confirmation token \`${input.globals.confirmNetwork}\` does not match active network \`${network.meta.name}\`.`,
      hint: `Pass \`--confirm-network ${network.meta.name}\` to approve this named network.`,
    });
  }

  if (network.chain_id_guard === null) {
    throw new ProjectError({
      code: "confirm_network_chain_id_required",
      message: `Network \`${network.meta.name}\` needs a chain-id guard before automation can write.`,
      hint: "Configure the profile with `--chain-id` or pass the expected `--chain-id`.",
    });
  }

  await verifyNetworkChainId({ network, cwd: input.cwd, env: input.env });
  return network;
}

export async function resolveCliReadNetworkRuntime(input: {
  readonly globals: GlobalArgs;
  readonly cwd: string;
  readonly env: CliEnv;
}): Promise<NetworkRuntime> {
  const network = resolveCliNetworkRuntime(input);
  if (input.globals.chainId !== undefined) {
    await verifyNetworkChainId({ network, cwd: input.cwd, env: input.env });
  }
  return network;
}

async function verifyNetworkChainId(input: {
  readonly network: NetworkRuntime;
  readonly cwd: string;
  readonly env: CliEnv;
}): Promise<void> {
  const expected = input.network.chain_id_guard;
  if (expected === null) {
    return;
  }

  const result = await runCastChainId({
    cwd: input.cwd,
    env: input.env,
    rpcUrl: input.network.rpc_url,
  });
  if (!result.ok) {
    throw new ProjectError({
      code: "chain_id_check_failed",
      message: `Could not verify chain id for ${input.network.meta.name}.`,
      hint: result.stderr.trim() || result.stdout.trim() || result.error,
    });
  }

  const actual = Number(result.stdout.trim());
  if (!Number.isSafeInteger(actual) || actual !== expected) {
    throw new ProjectError({
      code: "chain_id_mismatch",
      message: `RPC chain id ${result.stdout.trim()} does not match expected ${expected} for ${input.network.meta.name}.`,
      hint: "Check the selected network profile and RPC URL before retrying.",
    });
  }
}

function remoteConfirmationRequired(networkName: string): ProjectError {
  return new ProjectError({
    code: "remote_confirmation_required",
    message: `Remote writes on ${networkName} require typed confirmation.`,
    hint: `Pass \`--confirm-network ${networkName}\` for JSON/NDJSON automation after verifying the network.`,
  });
}
