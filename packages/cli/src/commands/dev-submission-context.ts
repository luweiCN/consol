import { accountMetaFromSelector, activeAccountMeta, loadConsolConfig } from "@consol/core";
import type { AccountMeta, TxPreviewEvent } from "@consol/protocol";
import type { FunctionInputSubmission } from "@consol/tui";
import type { GlobalArgs } from "../args";
import type { CliEnv } from "../main";

export function sessionActionGlobals(globals: GlobalArgs): GlobalArgs {
  const { project: _project, ...rest } = globals;
  return rest;
}

export function actionGlobalsForSubmission(globals: GlobalArgs, submission: FunctionInputSubmission): GlobalArgs {
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

export function gasLimitArgs(event: TxPreviewEvent): readonly string[] {
  const gasLimit = event.gas.context?.["gasLimit"];
  return gasLimit === undefined || gasLimit === null || String(gasLimit).trim().length === 0
    ? []
    : ["--gas-limit", String(gasLimit)];
}

export function accountMetaForSubmission(env: CliEnv, globals: GlobalArgs, submission: FunctionInputSubmission): AccountMeta {
  const selector = submission.accountName ?? globals.account ?? globals.signer;
  return selector === undefined ? activeAccountMeta(env) : accountMetaFromSelector(loadConsolConfig(env), selector);
}
