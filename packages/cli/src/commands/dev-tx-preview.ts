import { activeNetworkRuntime, ProjectError, type DevSession } from "@consol/core";
import { runCastCalldata, runCastEstimate } from "@consol/foundry";
import type { AccountMeta, NetworkMeta, TxPreviewEvent } from "@consol/protocol";
import type { ConfirmedTxPreviewResult, FunctionInputSubmission } from "@consol/tui";
import type { GlobalArgs } from "../args";
import type { CliEnv } from "../main";
import { createReadContext } from "./interact-context";
import { createDeployGasPreview } from "./dev-deploy-gas-preview";
import { devSessionActionContext } from "./dev-session-context";
import { accountMetaForSubmission, actionGlobalsForSubmission } from "./dev-submission-context";
import { ensureDevArtifact } from "./dev-artifact";
import { enrichRevertError } from "./dev-revert";
import { networkRuntimeForSelection, type CreateDevRpcAdapter } from "./dev-runtime";

export type DevActionContext = {
  readonly cwd: string;
  readonly target: string;
  readonly address?: string;
  readonly globals?: GlobalArgs;
};

// Narrowed view of the dev command input shared by tx preview/confirm.
// `RunDevCommandInput` structurally satisfies this.
export type DevTxInput = {
  readonly globals: GlobalArgs;
  readonly cwd: string;
  readonly env: CliEnv;
  readonly createRpcAdapter?: CreateDevRpcAdapter;
};

export async function createFunctionInputPreview(
  input: DevTxInput,
  submission: FunctionInputSubmission,
  previewActionContexts: Map<string, DevActionContext>,
  previewFollowups: Map<string, FunctionInputSubmission>,
): Promise<TxPreviewEvent | ConfirmedTxPreviewResult> {
  if (submission.action === "read") {
    try {
      return await createReadInputPreview(input, submission, previewActionContexts);
    } catch (error) {
      if (shouldDeployBeforeFunction(error)) {
        return await createDeployBeforeFunctionPreview(input, submission, previewActionContexts, previewFollowups);
      }
      throw error;
    }
  }

  if (submission.action === "deploy" || submission.action === "redeploy") {
    assertDeployableSession(submission.session);
    const sessionContext = devSessionActionContext(submission.session);
    const actionCwd = submission.cwdOverride ?? sessionContext.cwd;
    const actionTarget = submission.targetOverride ?? sessionContext.target;
    const actionGlobals = actionGlobalsForSubmission(input.globals, submission);
    const event = await createDeployInputPreview(input, submission, {
      cwd: actionCwd,
      target: actionTarget,
      globals: actionGlobals,
    });
    previewActionContexts.set(event.id, {
      cwd: actionCwd,
      target: actionTarget,
      globals: actionGlobals,
    });
    return event;
  }

  const sessionContext = devSessionActionContext(submission.session);
  const actionCwd = submission.cwdOverride ?? sessionContext.cwd;
  const actionGlobals = actionGlobalsForSubmission(input.globals, submission);
  const context = await createReadContext({
    globals: actionGlobals,
    cwd: actionCwd,
    env: input.env,
    target: submission.targetOverride ?? sessionContext.target,
    ...(submission.addressOverride === undefined ? {} : { addressOverride: submission.addressOverride }),
    ensureArtifact: async (resolved) => {
      await ensureDevArtifact(input, { target: submission.targetOverride ?? sessionContext.target, resolved });
    },
  }).catch((error: unknown) => {
    if (shouldDeployBeforeFunction(error)) {
      return null;
    }
    throw error;
  });
  if (context === null) {
    return await createDeployBeforeFunctionPreview(input, submission, previewActionContexts, previewFollowups);
  }
  const calldata = await runCastCalldata({
    cwd: context.resolved.projectRoot,
    env: input.env,
    signature: submission.function.signature,
    args: submission.args,
  });
  if (!calldata.ok) {
    throw new ProjectError({
      code: "calldata_preview_failed",
      message: `Failed to encode calldata for ${submission.function.signature}.`,
      hint: calldata.stderr.trim() || calldata.stdout.trim() || calldata.error,
    });
  }

  const gas = await runCastEstimate({
    cwd: context.resolved.projectRoot,
    env: input.env,
    rpcUrl: context.rpc_url,
    address: submission.addressOverride ?? context.address,
    signature: submission.function.signature,
    args: submission.args,
    ...(context.account.address === null ? {} : { from: context.account.address }),
    ...(submission.value === null ? {} : { value: submission.value }),
  });
  const event: TxPreviewEvent = {
    type: "tx.preview",
    id: `function-preview-${Date.now()}`,
    timestamp: new Date().toISOString(),
    action: "send",
    network: txPreviewNetwork(context.network),
    account: txPreviewAccount(context.account),
    signer: txPreviewSigner(context.account),
    target: {
      display: submission.targetOverride ?? submission.session.target,
      contract: submission.contractOverride ?? submission.session.contract,
      sourceMode: submission.session.sourceMode,
      ...(submission.session.sourceFile == null ? {} : { sourceFile: submission.session.sourceFile }),
    },
    calldata: {
      function: submission.function.name,
      signature: submission.function.signature,
      args: [...submission.args],
      hex: calldata.stdout.trim(),
    },
    ...(submission.value === null ? {} : { value: submission.value }),
    gas: {
      source: "rpc_estimate",
      ...(gas.ok ? { estimate: gas.stdout.trim() } : {}),
      confidence: gas.ok ? "medium" : "low",
      context: {
        ...(submission.gasLimit == null ? {} : { gasLimit: submission.gasLimit }),
        ...(gas.ok ? {} : { error: enrichRevertError(gas.stderr.trim() || gas.stdout.trim() || gas.error, submission.session) }),
      },
    },
  };
  previewActionContexts.set(event.id, {
    ...sessionContext,
    cwd: actionCwd,
    target: submission.targetOverride ?? sessionContext.target,
    ...(submission.addressOverride === undefined ? {} : { address: submission.addressOverride }),
    globals: actionGlobals,
  });
  return event;
}

function assertDeployableSession(session: DevSession): void {
  if (session.deployable !== false) {
    return;
  }

  throw new ProjectError({
    code: "dev_target_not_deployable",
    message: `${session.contract} cannot be deployed from the TUI.`,
    hint: session.deployReason ?? "Select a concrete contract with deployable bytecode.",
  });
}

async function createReadInputPreview(
  input: DevTxInput,
  submission: FunctionInputSubmission,
  previewActionContexts: Map<string, DevActionContext>,
): Promise<TxPreviewEvent> {
  const sessionContext = devSessionActionContext(submission.session);
  const actionCwd = submission.cwdOverride ?? sessionContext.cwd;
  const actionGlobals = actionGlobalsForSubmission(input.globals, submission);
  const context = await createReadContext({
    globals: actionGlobals,
    cwd: actionCwd,
    env: input.env,
    target: submission.targetOverride ?? sessionContext.target,
    ...(submission.addressOverride === undefined ? {} : { addressOverride: submission.addressOverride }),
    ensureArtifact: async (resolved) => {
      await ensureDevArtifact(input, { target: submission.targetOverride ?? sessionContext.target, resolved });
    },
  });
  const calldata = await runCastCalldata({
    cwd: context.resolved.projectRoot,
    env: input.env,
    signature: submission.function.signature,
    args: submission.args,
  });
  if (!calldata.ok) {
    throw new ProjectError({
      code: "calldata_preview_failed",
      message: `Failed to encode calldata for ${submission.function.signature}.`,
      hint: calldata.stderr.trim() || calldata.stdout.trim() || calldata.error,
    });
  }

  const event: TxPreviewEvent = {
    type: "tx.preview",
    id: `read-preview-${Date.now()}`,
    timestamp: new Date().toISOString(),
    action: "read",
    network: txPreviewNetwork(context.network),
    account: txPreviewAccount(context.account),
    signer: txPreviewSigner(context.account),
    target: {
      display: submission.targetOverride ?? submission.session.target,
      contract: submission.contractOverride ?? submission.session.contract,
      sourceMode: submission.session.sourceMode,
      ...(submission.session.sourceFile == null ? {} : { sourceFile: submission.session.sourceFile }),
    },
    calldata: {
      function: submission.function.name,
      signature: submission.function.signature,
      args: [...submission.args],
      hex: calldata.stdout.trim(),
    },
    ...(submission.value === null ? {} : { value: submission.value }),
    gas: {
      source: "rpc_estimate",
      confidence: "low",
      context: { note: "read_call" },
    },
  };
  previewActionContexts.set(event.id, {
    ...sessionContext,
    cwd: actionCwd,
    target: submission.targetOverride ?? sessionContext.target,
    ...(submission.addressOverride === undefined ? {} : { address: submission.addressOverride }),
    globals: actionGlobals,
  });
  return event;
}

async function createDeployBeforeFunctionPreview(
  input: DevTxInput,
  submission: FunctionInputSubmission,
  previewActionContexts: Map<string, DevActionContext>,
  previewFollowups: Map<string, FunctionInputSubmission>,
): Promise<TxPreviewEvent> {
  assertDeployableSession(submission.session);

  if ((submission.session.constructor?.inputs.length ?? 0) > 0) {
    throw new ProjectError({
      code: "dev_deploy_constructor_args_required",
      message: `${submission.session.contract} must be deployed before ${submission.function.signature}.`,
      hint: "Press d and enter constructor arguments before running this function.",
    });
  }

  const sessionContext = devSessionActionContext(submission.session);
  const actionCwd = submission.cwdOverride ?? sessionContext.cwd;
  const actionGlobals = actionGlobalsForSubmission(input.globals, submission);
  const event = await createDeployInputPreview(input, {
    action: "deploy",
    session: submission.session,
    function: deploymentFunction(submission.session),
    args: [],
    value: null,
    ...(submission.gasLimit == null ? {} : { gasLimit: submission.gasLimit }),
    ...(submission.accountName === undefined ? {} : { accountName: submission.accountName }),
    ...(submission.networkName === undefined ? {} : { networkName: submission.networkName }),
    ...(submission.cwdOverride === undefined ? {} : { cwdOverride: submission.cwdOverride }),
  }, {
    cwd: actionCwd,
    target: sessionContext.target,
    globals: actionGlobals,
  });
  const followupCalldata = await runCastCalldata({
    cwd: actionCwd,
    env: input.env,
    signature: submission.function.signature,
    args: submission.args,
  });
  if (!followupCalldata.ok) {
    throw new ProjectError({
      code: "calldata_preview_failed",
      message: `Failed to encode calldata for ${submission.function.signature}.`,
      hint: followupCalldata.stderr.trim() || followupCalldata.stdout.trim() || followupCalldata.error,
    });
  }

  const eventWithFollowup: TxPreviewEvent = {
    ...event,
    followup: {
      action: submission.action === "read" ? "read" : "send",
      calldata: {
        function: submission.function.name,
        signature: submission.function.signature,
        args: [...submission.args],
        hex: followupCalldata.stdout.trim(),
      },
      ...(submission.value === null ? {} : { value: submission.value }),
      ...(submission.action === "send"
        ? {
            gas: {
              source: "rpc_estimate",
              confidence: "low",
              context: {
                note: "estimate_after_deploy",
                ...(submission.gasLimit == null ? {} : { gasLimit: submission.gasLimit }),
              },
            },
          }
        : {}),
    },
  };
  previewActionContexts.set(eventWithFollowup.id, { ...sessionContext, cwd: actionCwd, globals: actionGlobals });
  previewFollowups.set(eventWithFollowup.id, submission);
  return eventWithFollowup;
}

export function isTxPreviewEvent(value: TxPreviewEvent | ConfirmedTxPreviewResult): value is TxPreviewEvent {
  return "type" in value && value.type === "tx.preview";
}

function shouldDeployBeforeFunction(error: unknown): boolean {
  return error instanceof ProjectError && (error.code === "deployment_not_found" || error.code === "deployment_stale");
}

function deploymentFunction(session: DevSession): FunctionInputSubmission["function"] {
  return {
    name: "constructor",
    signature: session.constructor?.signature ?? "constructor()",
    state_mutability: session.constructor?.state_mutability ?? "nonpayable",
    kind: session.constructor?.state_mutability === "payable" ? "payable" : "write",
    inputs: session.constructor?.inputs ?? [],
    outputs: [],
  };
}

async function createDeployInputPreview(
  input: DevTxInput,
  submission: FunctionInputSubmission,
  actionContext: Pick<DevActionContext, "cwd" | "target" | "globals">,
): Promise<TxPreviewEvent> {
  const activeRuntime = activeNetworkRuntime(input.env);
  const networkRuntime = submission.networkName === undefined
    ? { meta: activeRuntime.meta, rpcUrl: activeRuntime.rpc_url }
    : networkRuntimeForSelection(input, submission.networkName);
  const account = accountMetaForSubmission(input.env, input.globals, submission);
  const gas = await createDeployGasPreview({
    env: input.env,
    cwd: actionContext.cwd,
    target: actionContext.target,
    ...(actionContext.globals === undefined ? {} : { globals: actionContext.globals }),
    rpcUrl: networkRuntime.rpcUrl,
    account,
    action: submission.action === "redeploy" ? "redeploy" : "deploy",
    signature: submission.function.signature,
    args: submission.args,
    value: submission.value,
    ...(submission.gasLimit == null ? {} : { gasLimit: submission.gasLimit }),
  });
  return {
    type: "tx.preview",
    id: `deploy-preview-${Date.now()}`,
    timestamp: new Date().toISOString(),
    action: "deploy",
    network: txPreviewNetwork(networkRuntime.meta),
    account: txPreviewAccount(account),
    signer: txPreviewSigner(account),
    target: {
      display: submission.session.target,
      contract: submission.session.contract,
      sourceMode: submission.session.sourceMode,
      ...(submission.session.sourceFile == null ? {} : { sourceFile: submission.session.sourceFile }),
    },
    calldata: {
      function: submission.function.name,
      signature: submission.function.signature,
      args: [...submission.args],
      hex: "0x",
    },
    ...(submission.value === null ? {} : { value: submission.value }),
    gas,
  };
}

function txPreviewNetwork(network: NetworkMeta): TxPreviewEvent["network"] {
  if (network.chain_id === null) {
    throw new ProjectError({
      code: "network_chain_id_missing",
      message: `Network ${network.name} is missing chain id for transaction preview.`,
      hint: "Set chain_id on the network profile before sending from the TUI.",
    });
  }

  return {
    name: network.name,
    chainId: network.chain_id,
    fingerprint: network.fingerprint ?? network.name,
    writePolicy: txPreviewWritePolicy(network.write_policy),
  };
}

function txPreviewAccount(account: AccountMeta): TxPreviewEvent["account"] {
  if (account.address === null) {
    throw new ProjectError({
      code: "account_address_missing",
      message: `Account ${account.name} is missing an address for transaction preview.`,
      hint: "Select an account profile with an address while TUI signer derivation is being wired.",
    });
  }

  return {
    name: account.name,
    address: account.address,
  };
}

function txPreviewSigner(account: AccountMeta): TxPreviewEvent["signer"] {
  return {
    name: account.name,
    source: txPreviewSignerSource(account.signer),
    ...(account.address === null ? {} : { address: account.address }),
    available: account.address !== null,
  };
}

function txPreviewWritePolicy(value: string): TxPreviewEvent["network"]["writePolicy"] {
  switch (value) {
    case "local":
    case "confirm":
    case "typed-confirm":
    case "read-only":
      return value;
    default:
      return "confirm";
  }
}

function txPreviewSignerSource(value: string): TxPreviewEvent["signer"]["source"] {
  switch (value) {
    case "anvil-index":
    case "env-private-key":
    case "keystore":
      return value;
    default:
      return "unknown";
  }
}
