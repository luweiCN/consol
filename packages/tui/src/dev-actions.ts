import type { DevAction, DevSession, FunctionItem } from "@consol/core";
import { functionNeedsInput } from "./dev-function-model";

export type OpenFunctionInputAction = Extract<DevAction, { readonly type: "openFunctionInput" }>;
export type SubmitFunctionAction = Extract<DevAction, { readonly type: "submitFunction" }>;
export type SelectedFunctionAction = OpenFunctionInputAction | SubmitFunctionAction;

export function selectedFunctionInputAction(input: {
  readonly session: DevSession | undefined;
  readonly deploySelected: boolean;
  readonly deployAction?: Extract<SubmitFunctionAction["action"], "deploy" | "redeploy">;
  readonly selectedFunctionIndex: number;
  readonly functions?: readonly FunctionItem[];
  readonly accountName?: string;
  readonly networkName?: string;
  readonly targetOverride?: string;
  readonly contractOverride?: string;
  readonly addressOverride?: string;
  readonly cwdOverride?: string;
}): SelectedFunctionAction | null {
  if (input.deploySelected && input.session !== undefined) {
    if (input.session.deployable === false) {
      return null;
    }

    const action = input.deployAction ?? "deploy";
    const functionItem = {
      name: "constructor",
      signature: input.session.constructor?.signature ?? "constructor()",
      state_mutability: input.session.constructor?.state_mutability ?? "nonpayable",
      kind: input.session.constructor?.state_mutability === "payable" ? "payable" : "write",
      inputs: input.session.constructor?.inputs ?? [],
      outputs: [],
    } as const;

    return functionNeedsInput(functionItem)
      ? actionWithRuntime({ type: "openFunctionInput", action, function: functionItem }, input)
      : actionWithRuntime({ type: "submitFunction", action, function: functionItem }, input);
  }

  const functionItem = (input.functions ?? input.session?.functions)?.[input.selectedFunctionIndex];
  if (functionItem === undefined) {
    return null;
  }

  const action = functionItem.kind === "read" ? "read" : "send";
  return functionNeedsInput(functionItem)
    ? actionWithRuntime({ type: "openFunctionInput", function: functionItem, action }, input)
    : actionWithRuntime({ type: "submitFunction", function: functionItem, action }, input);
}

function actionWithRuntime<T extends SelectedFunctionAction>(
  action: T,
  input: {
    readonly accountName?: string;
    readonly networkName?: string;
    readonly targetOverride?: string;
    readonly contractOverride?: string;
    readonly addressOverride?: string;
    readonly cwdOverride?: string;
  },
): T {
  return {
    ...action,
    ...(input.accountName === undefined ? {} : { accountName: input.accountName }),
    ...(input.networkName === undefined ? {} : { networkName: input.networkName }),
    ...(input.targetOverride === undefined ? {} : { targetOverride: input.targetOverride }),
    ...(input.contractOverride === undefined ? {} : { contractOverride: input.contractOverride }),
    ...(input.addressOverride === undefined ? {} : { addressOverride: input.addressOverride }),
    ...(input.cwdOverride === undefined ? {} : { cwdOverride: input.cwdOverride }),
  };
}
