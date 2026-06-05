import { accountMetaFromSelector, activeAccountMeta, defaultAccountMeta, loadConsolConfig, ProjectError } from "@consol/core";
import { createSuccessEnvelope } from "@consol/protocol";
import type { AccountMeta } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";

export type RunSignerCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly env: CliEnv;
};

type SignerListItem = {
  readonly name: string;
  readonly source: string;
  readonly account: string;
  readonly address: string | null;
  readonly active: boolean;
  readonly available: boolean;
};

export function runSignerCommand(input: RunSignerCommandInput): CliResult {
  const subcommand = input.commandArgs.find((arg) => arg !== "--json");
  if (subcommand === "status") {
    return signerStatus(input);
  }

  if (subcommand !== "list") {
    return { exitCode: 1, stdout: "", stderr: "Unsupported signer command.\n" };
  }

  return signerList(input);
}

function signerList(input: RunSignerCommandInput): CliResult {
  const account = activeAccountForCommand(input);
  const data = {
    active: account.name,
    signers: signerItems(input, account),
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "signer list",
        account,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `Active signer: ${data.active}\n`, stderr: "" };
}

function signerStatus(input: RunSignerCommandInput): CliResult {
  const account = activeAccountForCommand(input);
  const signers = signerItems(input, account);
  const name = statusName(input.commandArgs);
  const data =
    name === undefined
      ? signers.find((signer) => signer.active)
      : signers.find((signer) => signer.name === name);
  if (data === undefined) {
    throw new ProjectError({
      code: "signer_not_found",
      message: name === undefined ? "No active signer profile is available." : `Signer profile \`${name}\` does not exist.`,
      hint: "Run `consol signer list` to see configured signers.",
    });
  }

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "signer status",
        account,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `Signer: ${data.name}\n`, stderr: "" };
}

function signerItems(input: RunSignerCommandInput, activeAccount: AccountMeta): readonly SignerListItem[] {
  const config = loadConsolConfig(input.env);
  return [
    signerItem("anvil0", defaultAccountMeta(), activeAccount, true),
    ...(input.env.ETH_PRIVATE_KEY === undefined
      ? []
      : [signerItem("env", { name: "env", address: null, signer: "env-private-key" }, activeAccount, true)]),
    ...Object.keys(config.accounts)
      .sort((left, right) => left.localeCompare(right))
      .map((name) => {
        const profile = config.accounts[name];
        const account = accountMetaFromSelector(config, name);
        return signerItem(name, account, activeAccount, profile === undefined ? false : signerAvailable(profile, input.env));
      }),
  ];
}

function signerItem(name: string, account: AccountMeta, activeAccount: AccountMeta, available: boolean): SignerListItem {
  return {
    name,
    source: account.signer,
    account: account.name,
    address: account.address,
    active: account.name === activeAccount.name,
    available,
  };
}

function activeAccountForCommand(input: RunSignerCommandInput): AccountMeta {
  if (input.globals.account !== undefined || input.globals.signer !== undefined) {
    const config = loadConsolConfig(input.env);
    const selector = input.globals.account ?? input.globals.signer ?? "anvil0";
    const account = accountMetaFromSelector(config, selector);
    if (account.signer === "selected") {
      throw new ProjectError({
        code: input.globals.account === undefined ? "signer_not_found" : "account_not_found",
        message: `Account profile \`${selector}\` does not exist.`,
        hint: "Run `consol account list` or import one with `consol account import`.",
      });
    }
    return account;
  }
  return activeAccountMeta(input.env);
}

function signerAvailable(
  profile: {
    readonly private_key_env?: string;
    readonly password_env?: string;
    readonly keystore?: string;
    readonly signer?: string;
  },
  env: CliEnv,
): boolean {
  const source = profile.signer ?? (profile.keystore === undefined ? "env-private-key" : "keystore");
  if (source === "env-private-key") {
    return profile.private_key_env === undefined ? false : env[profile.private_key_env] !== undefined;
  }
  if (source === "keystore") {
    return profile.password_env === undefined ? false : env[profile.password_env] !== undefined;
  }
  return false;
}

function statusName(commandArgs: readonly string[]): string | undefined {
  const index = commandArgs.findIndex((arg) => arg === "status");
  if (index === -1) {
    return undefined;
  }
  return commandArgs.slice(index + 1).find((arg) => arg !== "--json");
}
