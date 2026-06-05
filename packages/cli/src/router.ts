import { createTranslator, type Locale } from "@consol/i18n";
import { createErrorEnvelope, createUserError } from "@consol/protocol";
import type { CliResult } from "./main";
import type { ParsedCliArgs } from "./args";
import { runActivityCommand } from "./commands/activity";
import { runAccountCommand } from "./commands/account";
import { runAbiCommand } from "./commands/abi";
import { runAnalyzeCommand } from "./commands/analyze";
import { runBuildCommand } from "./commands/build";
import { runChainCommand } from "./commands/chain";
import { runConsoleCommand } from "./commands/console";
import { runDemoCommand } from "./commands/demo";
import { runDetectCommand } from "./commands/detect";
import { runDeployCommand } from "./commands/deploy";
import { runDevCommand } from "./commands/dev";
import { createDoctorPayload } from "./commands/doctor";
import { runGasCommand } from "./commands/gas";
import { runHintsCommand } from "./commands/hints";
import { runCallCommand, runStateCommand } from "./commands/interact";
import { runInitCommand } from "./commands/init";
import { runInspectCommand } from "./commands/inspect";
import { runLogsCommand } from "./commands/logs";
import { runNetworkCommand } from "./commands/network";
import { runSendCommand } from "./commands/send";
import { runSignerCommand } from "./commands/signer";
import { runSnapshotCommand } from "./commands/snapshot";
import { runStorageCommand } from "./commands/storage";
import { runTestCommand } from "./commands/test";
import { runTraceCommand } from "./commands/trace";
import { runTxCommand } from "./commands/tx";
import { runVerifyCommand } from "./commands/verify";
import { VERSION } from "./version";

export type RouteCliInput = {
  readonly parsed: ParsedCliArgs;
  readonly locale: Locale;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
};

export async function routeCli(input: RouteCliInput): Promise<CliResult> {
  const t = createTranslator(input.locale);
  const { command, commandArgs, globals } = input.parsed;

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    return success(`${t("cli.help")}\n`);
  }

  if (command === "--version" || command === "-V") {
    return success(`consol ${VERSION}\n`);
  }

  if (command === "doctor") {
    if (globals.json || commandArgs.includes("--json")) {
      return success(`${JSON.stringify(createDoctorPayload(input.locale), null, 2)}\n`);
    }

    return success(`${t("cli.doctor.ok")}\n`);
  }

  if (command === "detect") {
    return await runDetectCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "init") {
    return runInitCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
    });
  }

  if (command === "build") {
    return await runBuildCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "test") {
    return await runTestCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "analyze") {
    return await runAnalyzeCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "inspect") {
    return runInspectCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
    });
  }

  if (command === "abi") {
    return runAbiCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
    });
  }

  if (command === "network") {
    return runNetworkCommand({
      globals,
      commandArgs,
      env: input.env,
    });
  }

  if (command === "account") {
    return await runAccountCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "signer") {
    return runSignerCommand({
      globals,
      commandArgs,
      env: input.env,
    });
  }

  if (command === "storage") {
    return await runStorageCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "chain") {
    return await runChainCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "deploy") {
    return await runDeployCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "dev") {
    return await runDevCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
      locale: input.locale,
    });
  }

  if (command === "console") {
    return runConsoleCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "demo") {
    return await runDemoCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "snapshot") {
    return runSnapshotCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "tx") {
    return runTxCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
    });
  }

  if (command === "trace") {
    return await runTraceCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "verify") {
    return await runVerifyCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "call") {
    return await runCallCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "state") {
    return await runStateCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "send") {
    return await runSendCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "logs") {
    return await runLogsCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "activity") {
    return await runActivityCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "gas") {
    return await runGasCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  if (command === "hints") {
    return await runHintsCommand({
      globals,
      commandArgs,
      cwd: input.cwd,
      env: input.env,
    });
  }

  const error = createUserError({
    code: "command_not_implemented",
    message: t("cli.error.unsupportedCommand", { command }),
    details: { command },
  });

  if (globals.json) {
    return success(`${JSON.stringify(createErrorEnvelope({ error, meta: { version: VERSION, command } }), null, 2)}\n`, 1);
  }

  return { exitCode: 1, stdout: "", stderr: `${error.message}\n` };
}

function success(stdout: string, exitCode = 0): CliResult {
  return { exitCode, stdout, stderr: "" };
}
