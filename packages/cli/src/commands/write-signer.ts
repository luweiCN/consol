import { accountMetaFromSelector, activeAccountMeta, loadConsolConfig, ProjectError } from "@consol/core";
import type { FoundryWallet } from "@consol/foundry";
import type { AccountMeta } from "@consol/protocol";
import type { NetworkMeta } from "@consol/protocol";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { GlobalArgs } from "../args";
import type { CliEnv } from "../main";
import { privateKeyForAnvilAccount } from "./local-signer";

export type WriteSigner = {
  readonly account: AccountMeta;
  readonly wallet: {
    readonly kind: "unlocked";
    readonly from: string;
  } | {
    readonly kind: "private-key-env";
    readonly privateKey: string;
  };
};

export function resolveWriteSigner(input: { readonly globals: GlobalArgs; readonly env: CliEnv }): WriteSigner {
  const config = loadConsolConfig(input.env);
  const account = selectedAccount(input, config);
  return {
    account,
    wallet: walletForAccount(account, config, input.env),
  };
}

export function foundryWalletForNetwork(signer: WriteSigner, network: NetworkMeta): FoundryWallet {
  if (signer.wallet.kind === "unlocked") {
    return signer.wallet;
  }
  if (network.kind === "anvil" || network.kind === "anvil-fork") {
    return { kind: "unlocked", from: privateKeyAddress(signer.wallet.privateKey) };
  }
  return signer.wallet;
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

function walletForAccount(
  account: AccountMeta,
  config: ReturnType<typeof loadConsolConfig>,
  env: CliEnv,
): WriteSigner["wallet"] {
  const anvilPrivateKey = privateKeyForAnvilAccount(account.name);
  if (anvilPrivateKey !== null) {
    if (account.address === null) {
      throw new ProjectError({
        code: "signer_profile_invalid",
        message: `Anvil account \`${account.name}\` is missing an address.`,
        hint: "Select a built-in anvil account such as anvil0.",
      });
    }
    return { kind: "unlocked", from: account.address };
  }
  if (account.name === "env") {
    return { kind: "private-key-env", privateKey: requiredEnv("ETH_PRIVATE_KEY", env) };
  }
  const profile = config.accounts[account.name];
  if (profile === undefined) {
    throw new ProjectError({
      code: "signer_not_found",
      message: `Signer profile \`${account.name}\` does not exist.`,
      hint: "Run `consol signer list` or import one with `consol account import`.",
    });
  }
  if ((profile.signer ?? "env-private-key") !== "env-private-key") {
    throw new ProjectError({
      code: "signer_profile_invalid",
      message: `Account profile \`${account.name}\` uses unsupported signer \`${profile.signer ?? "unknown"}\`.`,
      hint: "Select an env-backed account while the TS rewrite wires additional signer sources.",
    });
  }
  if (profile.private_key_env === undefined) {
    throw new ProjectError({
      code: "signer_profile_invalid",
      message: `Account profile \`${account.name}\` is missing private_key_env.`,
      hint: "Recreate the account profile with `consol account import`.",
    });
  }
  return { kind: "private-key-env", privateKey: requiredEnv(profile.private_key_env, env) };
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

function privateKeyAddress(privateKey: string): string {
  try {
    const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
    return privateKeyToAccount(normalized as Hex).address.toLowerCase();
  } catch (error) {
    throw new ProjectError({
      code: "signer_private_key_invalid",
      message: "Signer private key is invalid.",
      hint: error instanceof Error ? error.message : String(error),
    });
  }
}
