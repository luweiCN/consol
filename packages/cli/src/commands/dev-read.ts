import { runCastCall } from "@consol/foundry";
import type { ConfirmedTxPreviewResult, FunctionInputSubmission } from "@consol/tui";
import type { GlobalArgs } from "../args";
import type { CliEnv } from "../main";
import { devSessionActionContext } from "./dev-session-context";
import { createReadContext } from "./interact-context";

export async function executeReadFunctionInput(
  input: { readonly globals: GlobalArgs; readonly env: CliEnv },
  submission: FunctionInputSubmission,
): Promise<ConfirmedTxPreviewResult> {
  const sessionContext = devSessionActionContext(submission.session);
  const context = await createReadContext({
    globals: actionGlobalsForSubmission(input.globals, submission),
    cwd: sessionContext.cwd,
    env: input.env,
    target: sessionContext.target,
  });
  const call = await runCastCall({
    cwd: context.resolved.projectRoot,
    env: input.env,
    rpcUrl: context.rpc_url,
    address: context.address,
    signature: submission.function.signature,
    args: submission.args,
  });

  return {
    status: call.ok ? "ok" : "error",
    message: call.ok
      ? `${context.resolved.contractName} ${submission.function.signature} -> ${call.stdout.trim()}`
      : `cast call failed for ${submission.function.signature}.`,
  };
}

function sessionActionGlobals(globals: GlobalArgs): GlobalArgs {
  const { project: _project, ...rest } = globals;
  return rest;
}

function actionGlobalsForSubmission(globals: GlobalArgs, submission: FunctionInputSubmission): GlobalArgs {
  const base = sessionActionGlobals(globals);
  if (submission.accountName === undefined && submission.networkName === undefined) {
    return base;
  }

  const { signer: _signer, ...withoutSigner } = base;
  return {
    ...withoutSigner,
    ...(submission.accountName === undefined ? {} : { account: submission.accountName }),
    ...(submission.networkName === undefined ? {} : { network: submission.networkName }),
  };
}
