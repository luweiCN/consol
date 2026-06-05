import {
  accountMetaFromSelector,
  activeAccountMeta,
  defaultAccountMeta,
  loadConsolConfig,
  ProjectError,
  saveAccountProfile,
  saveActiveAccount,
} from "@consol/core";
import { runCastBalance } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import type { AccountMeta } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import { resolveCliReadNetworkRuntime } from "./network-runtime";

export type RunAccountCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
};

export async function runAccountCommand(input: RunAccountCommandInput): Promise<CliResult> {
  const subcommand = input.commandArgs.find((arg) => arg !== "--json");
  if (subcommand === "import") {
    return accountImport(input);
  }
  if (subcommand === "use") {
    return accountUse(input);
  }
  if (subcommand === "balance") {
    return await accountBalance(input);
  }

  if (subcommand !== "list") {
    return { exitCode: 1, stdout: "", stderr: "Unsupported account command.\n" };
  }

  return accountList(input);
}

function accountList(input: RunAccountCommandInput): CliResult {
  const config = loadConsolConfig(input.env);
  const account = activeAccountForCommand(input);
  const data = {
    active: account.name,
    accounts: [
      defaultAccountMeta(),
      ...(input.env.ETH_PRIVATE_KEY === undefined
        ? []
        : [{ name: "env", address: null, signer: "env-private-key" } satisfies AccountMeta]),
      ...Object.keys(config.accounts)
        .sort((left, right) => left.localeCompare(right))
        .map((name) => accountMetaFromSelector(config, name)),
    ],
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "account list",
        account,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `Active account: ${data.active}\n`, stderr: "" };
}

function accountImport(input: RunAccountCommandInput): CliResult {
  const name = requiredAccountName(input.commandArgs, "import");
  if (name === "anvil0" || name === "env") {
    throw new ProjectError({
      code: "account_reserved",
      message: `\`${name}\` is a built-in account name.`,
      hint: "Use a different account profile name.",
    });
  }
  const privateKeyEnv = requiredPrivateKeyEnv(input.commandArgs);
  const configPath = saveAccountProfile({
    env: input.env,
    name,
    profile: {
      private_key_env: privateKeyEnv,
      signer: "env-private-key",
    },
  });
  const account: AccountMeta = { name, address: null, signer: "env-private-key" };
  const config = loadConsolConfig(input.env);
  return accountAction(input, {
    action: "imported",
    name,
    active: config.active_account ?? "anvil0",
    config_path: configPath,
    account,
  });
}

function accountUse(input: RunAccountCommandInput): CliResult {
  const name = requiredAccountName(input.commandArgs, "use");
  const config = loadConsolConfig(input.env);
  const account = accountMetaFromSelector(config, name);
  if (account.signer === "selected") {
    throw new ProjectError({
      code: "account_not_found",
      message: `Account profile \`${name}\` does not exist.`,
      hint: "Run `consol account list` or import one with `consol account import`.",
    });
  }
  const configPath = saveActiveAccount({ env: input.env, name });
  return accountAction(input, {
    action: "selected",
    name,
    active: name,
    config_path: configPath,
    account,
  });
}

function accountAction(
  input: RunAccountCommandInput,
  data: {
    readonly action: "imported" | "selected";
    readonly name: string;
    readonly active: string;
    readonly config_path: string;
    readonly account: AccountMeta;
  },
): CliResult {
  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: `account ${data.action}`,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }
  return { exitCode: 0, stdout: `account ${data.action}: ${data.name}\n  active: ${data.active}\n`, stderr: "" };
}

async function accountBalance(input: RunAccountCommandInput): Promise<CliResult> {
  const account = activeAccountForCommand(input);
  const network = await resolveCliReadNetworkRuntime({ globals: input.globals, cwd: input.cwd, env: input.env });
  const selector = balanceSelector(input.commandArgs) ?? account.address ?? account.name;
  const result = await runCastBalance({
    cwd: input.cwd,
    env: input.env,
    rpcUrl: network.rpc_url,
    selector,
  });
  const data = {
    selector,
    wei: result.ok ? result.stdout.trim() : null,
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "account balance",
        network: network.meta,
        account,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  return { exitCode: 0, stdout: `Balance ${data.selector}: ${data.wei ?? "unknown"} wei\n`, stderr: "" };
}

function balanceSelector(commandArgs: readonly string[]): string | undefined {
  const index = commandArgs.findIndex((arg) => arg === "balance");
  if (index === -1) {
    return undefined;
  }
  return commandArgs.slice(index + 1).find((arg) => arg !== "--json");
}

function activeAccountForCommand(input: RunAccountCommandInput): AccountMeta {
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

function requiredAccountName(commandArgs: readonly string[], subcommand: "import" | "use"): string {
  const name = commandArgs[1];
  if (name === undefined || name.startsWith("--")) {
    throw new ProjectError({
      code: "account_name_required",
      message: "Missing account profile name.",
      hint: `Use \`consol account ${subcommand} <name>\`.`,
    });
  }
  return name;
}

function requiredPrivateKeyEnv(commandArgs: readonly string[]): string {
  const flagIndex = commandArgs.findIndex((arg) => arg === "--private-key-env");
  const value = flagIndex === -1 ? undefined : commandArgs[flagIndex + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new ProjectError({
      code: "account_import_signer_missing",
      message: "Account import requires a signer source.",
      hint: "Use `--private-key-env <ENV>`.",
    });
  }
  return value;
}
