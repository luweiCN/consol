import { ProjectError } from "@consol/core";

export type DeployOptions = {
  readonly target: string;
  readonly constructorArgs: readonly string[];
  readonly fresh: boolean;
  readonly value?: string;
  readonly gasLimit?: string;
  readonly skipBuild?: boolean;
  readonly libraries: readonly string[];
};

export function parseDeployOptions(commandArgs: readonly string[]): DeployOptions {
  let target: string | undefined;
  const constructorArgs: string[] = [];
  let fresh = false;
  let value: string | undefined;
  let gasLimit: string | undefined;
  const libraries: string[] = [];

  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (arg === undefined || arg === "--json" || arg === "--yes") {
      continue;
    }
    if (arg === "--fresh") {
      fresh = true;
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
    if (arg === "--libraries") {
      const entry = commandArgs[index + 1];
      if (entry === undefined) {
        throw new ProjectError({
          code: "missing_flag_value",
          message: "Missing value for --libraries.",
          hint: "Pass Name:0xAddress after --libraries.",
        });
      }
      libraries.push(entry);
      index += 1;
      continue;
    }
    if (arg === "--confirm-network") {
      if (commandArgs[index + 1] === undefined) {
        throw new ProjectError({
          code: "missing_flag_value",
          message: "Missing value for --confirm-network.",
          hint: "Pass the active network name after --confirm-network.",
        });
      }
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new ProjectError({
        code: "deploy_arg_unsupported",
        message: `Unsupported deploy argument: ${arg}`,
        hint: "Use `consol deploy <target> [constructor_args...]`.",
      });
    }

    if (target === undefined) {
      target = arg;
    } else {
      constructorArgs.push(arg);
    }
  }

  if (target === undefined) {
    throw new ProjectError({
      code: "deploy_target_required",
      message: "Missing target for deploy.",
      hint: "Use `consol deploy <target> [constructor_args...]`.",
    });
  }

  return {
    target,
    constructorArgs,
    fresh,
    libraries,
    ...(value === undefined ? {} : { value }),
    ...(gasLimit === undefined ? {} : { gasLimit }),
  };
}

export function forgetTargetArg(commandArgs: readonly string[]): string | undefined {
  const index = commandArgs.indexOf("--forget");
  return index === -1 ? undefined : commandArgs[index + 1];
}
