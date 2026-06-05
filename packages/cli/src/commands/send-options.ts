import { ProjectError } from "@consol/core";

export type SendOptions = {
  readonly target: string;
  readonly functionName: string;
  readonly args: readonly string[];
  readonly address?: string;
  readonly value?: string;
  readonly gasLimit?: string;
};

export function parseSendOptions(commandArgs: readonly string[]): SendOptions {
  let target: string | undefined;
  let functionName: string | undefined;
  let address: string | undefined;
  let value: string | undefined;
  let gasLimit: string | undefined;
  const args: string[] = [];

  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (arg === undefined || arg === "--json" || arg === "--yes") {
      continue;
    }
    if (arg === "--value") {
      const amount = commandArgs[index + 1];
      if (amount === undefined) {
        throw new ProjectError({
          code: "missing_flag_value",
          message: "Missing value for --value.",
          hint: "Pass an ETH amount after --value.",
        });
      }
      value = amount;
      index += 1;
      continue;
    }
    if (arg === "--address") {
      const nextAddress = commandArgs[index + 1];
      if (nextAddress === undefined) {
        throw new ProjectError({
          code: "missing_flag_value",
          message: "Missing value for --address.",
          hint: "Pass a deployed contract address after --address.",
        });
      }
      address = nextAddress;
      index += 1;
      continue;
    }
    if (arg === "--gas-limit") {
      const limit = commandArgs[index + 1];
      if (limit === undefined) {
        throw new ProjectError({
          code: "missing_flag_value",
          message: "Missing value for --gas-limit.",
          hint: "Pass a gas limit after --gas-limit, or omit it to use auto.",
        });
      }
      gasLimit = limit;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new ProjectError({
        code: "send_arg_unsupported",
        message: `Unsupported send argument: ${arg}`,
        hint: "Use `consol send <target> <function> [args...] [--value <amount>]`.",
      });
    }

    if (target === undefined) {
      target = arg;
    } else if (functionName === undefined) {
      functionName = arg;
    } else {
      args.push(arg);
    }
  }

  if (target === undefined || functionName === undefined) {
    throw new ProjectError({
      code: "send_args_required",
      message: "Missing target or function for send.",
      hint: "Use `consol send <target> <function> [args...]`.",
    });
  }

  return {
    target,
    functionName,
    args,
    ...(address === undefined ? {} : { address }),
    ...(value === undefined ? {} : { value }),
    ...(gasLimit === undefined ? {} : { gasLimit }),
  };
}
