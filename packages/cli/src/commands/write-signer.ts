import { accountMetaFromSelector, activeAccountMeta, loadConsolConfig, ProjectError } from "@consol/core";
import type { AccountMeta } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv } from "../main";
import { privateKeyForAnvilAccount } from "./local-signer";

export type WriteSigner = {
  readonly account: AccountMeta;
  readonly privateKey: string;
};

export function resolveWriteSigner(input: { readonly globals: GlobalArgs; readonly env: CliEnv }): WriteSigner {
  const config = loadConsolConfig(input.env);
  const account = selectedAccount(input, config);
  return {
    account,
    privateKey: privateKeyForAccount(account.name, config, input.env),
  };
}

function selectedAccount(
  input: { readonly globals: GlobalArgs; readonly env: CliEnv },
  config: ReturnType<typeof loadConsolConfig>,
): AccountMeta {
  const { account, signer } = input.globals;
  if (account !== undefined && signer !== undefined && account !== signer) {
    throw new ProjectError({
      code: "account_signer_conflict",
      message: `--account ${account} cannot be combined with --signer ${signer}.`,
      hint: "Use the same profile name or omit one of the flags.",
    });
  }
  const selector = account ?? signer;
  const meta = selector === undefined ? activeAccountMeta(input.env) : accountMetaFromSelector(config, selector);
  if (meta.signer === "selected") {
    throw new ProjectError({
      code: selector === signer ? "signer_not_found" : "account_not_found",
      message: `Account profile \`${meta.name}\` does not exist.`,
      hint: "Run `consol account list` or import one with `consol account import`.",
    });
  }
  return meta;
}

function privateKeyForAccount(
  name: string,
  config: ReturnType<typeof loadConsolConfig>,
  env: CliEnv,
): string {
  const anvilPrivateKey = privateKeyForAnvilAccount(name);
  if (anvilPrivateKey !== null) {
    return anvilPrivateKey;
  }
  if (name === "env") {
    return requiredEnv("ETH_PRIVATE_KEY", env);
  }
  const profile = config.accounts[name];
  if (profile === undefined) {
    throw new ProjectError({
      code: "signer_not_found",
      message: `Signer profile \`${name}\` does not exist.`,
      hint: "Run `consol signer list` or import one with `consol account import`.",
    });
  }
  if ((profile.signer ?? "env-private-key") !== "env-private-key") {
    throw new ProjectError({
      code: "signer_profile_invalid",
      message: `Account profile \`${name}\` uses unsupported signer \`${profile.signer ?? "unknown"}\`.`,
      hint: "Select an env-backed account while the TS rewrite wires additional signer sources.",
    });
  }
  if (profile.private_key_env === undefined) {
    throw new ProjectError({
      code: "signer_profile_invalid",
      message: `Account profile \`${name}\` is missing private_key_env.`,
      hint: "Recreate the account profile with `consol account import`.",
    });
  }
  return requiredEnv(profile.private_key_env, env);
}

function requiredEnv(name: string, env: CliEnv): string {
  const value = env[name];
  if (value === undefined) {
    throw new ProjectError({
      code: "signer_env_missing",
      message: `Signer requires environment variable \`${name}\`.`,
      hint: `Set \`${name}\` or select another account.`,
    });
  }
  return value;
}
