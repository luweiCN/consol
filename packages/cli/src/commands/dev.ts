import {
  accountMetaFromSelector,
  createDevSessionFromResolved,
  defaultAnvilAccountMetas,
  loadConsolConfig,
  ProjectError,
  resolveConfigPaths,
  resolveDevSession,
  saveUiSettings,
  type DevSession,
  type ResolvedDevSession,
} from "@consol/core";
import type { RpcAdapter } from "@consol/rpc";
import { dirname } from "node:path";
import {
  runDevShell,
  type DevAccountStatusEntry,
  type DevAccountStatusSnapshot,
  type DevChainStateOption,
  type DevRuntimeSelection,
  type DevSettingsChange,
  type DevSettingsSnapshot,
  type DevLocalChainActionRequest,
  type DevLocalChainActionResult,
  type FunctionInputSubmission,
  type RunDevShellInput,
} from "@consol/tui";
import { normalizeLocale, resolveLocale, type Locale } from "@consol/i18n";
import { createSuccessEnvelope } from "@consol/protocol";
import type { AccountMeta } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import {
  listLocalChainStates,
  resetLocalChainData,
  restoreLocalChainStateData,
  saveLocalChainStateData,
  startLocalChainData,
  type ChainActionData,
  type ChainStateActionData,
} from "./chain";
import { createEntryLaunchInput, createSourceFileSelectHandler } from "./dev-entry";
import { ensureDevArtifact, executeDevBuild } from "./dev-artifact";
import { createDevStateRowDetailSnapshot, createDevStateSnapshot, saveDevStateKeyBookChange } from "./dev-state";
import { createDevJsonSnapshot } from "./dev-json";
import { devAccountOptions, devNetworkOptions } from "./dev-options";
import { sourcePreviewsForSession } from "./dev-source-preview";
import { commandTarget, commandTargetIndex, findDevDirectory, preferredDevTarget } from "./dev-target";
import { createDevDeployedContractsSnapshot } from "./dev-deployments";
import { createDevTrace } from "./dev-trace";
import { createDevBlockWatchHandler } from "./dev-event-watch";
import { networkRuntimeForSelection, rpcAdapterForRuntime, type CreateDevRpcAdapter } from "./dev-runtime";
import { errorMessage } from "./dev-unknown";
import { createDevEventRecordsSnapshot, createDevTransactionsSnapshot } from "./dev-records";
import { createFunctionInputPreview, type DevActionContext } from "./dev-tx-preview";
import { executeConfirmedTxPreview } from "./dev-tx-confirm";

export type LaunchTui = (input: RunDevShellInput) => Promise<void>;
export type { CreateDevRpcAdapter };

export type RunDevCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
  readonly locale: Locale;
  readonly launchTui?: LaunchTui;
  readonly createRpcAdapter?: CreateDevRpcAdapter;
};

export async function runDevCommand(input: RunDevCommandInput): Promise<CliResult> {
  const directoryInput = devDirectoryTargetInput(input);
  if (directoryInput !== null) {
    return await runDevCommand(directoryInput);
  }

  const previewActionContexts = new Map<string, DevActionContext>();
  const previewFollowups = new Map<string, FunctionInputSubmission>();
  const rawTarget = commandTarget(input.commandArgs) ?? "";
  const target = preferredDevTarget(input, rawTarget);
  const jsonOutput = input.globals.json || input.commandArgs.includes("--json");
  const entryLaunchInput =
    jsonOutput || target !== "" || input.globals.project !== undefined
      ? null
      : createDevEntryLaunchInput(input, previewActionContexts, previewFollowups);
  if (entryLaunchInput !== null) {
    await (input.launchTui ?? runDevShell)(entryLaunchInput);
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  const prepared = resolveDevSession({
    cwd: input.cwd,
    target,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  await ensureDevArtifact(input, prepared);
  const createdSession = createDevSessionFromResolved(prepared);
  const session = devSessionWithWorkspaceRoot(createdSession, prepared);

  if (jsonOutput) {
    const snapshot = await createDevJsonSnapshot({
      globals: input.globals,
      cwd: input.cwd,
      env: input.env,
      session,
    });
    const envelope = createSuccessEnvelope({
      data: snapshot.data,
      meta: {
        version: VERSION,
        command: "dev",
        project_root: session.projectRoot,
        network: snapshot.network,
        account: snapshot.account,
      },
    });
    return { exitCode: 0, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  const selection = initialRuntimeSelection(input);
  const deployedContracts = await createDevDeployedContractsSnapshot(input, session, selection.networkName);

  await (input.launchTui ?? runDevShell)({
    session,
    locale: input.locale,
    networkOptions: devNetworkOptions(input),
    accountOptions: devAccountOptions(input),
    sourcePreviews: sourcePreviewsForSession(session),
    accountStatus: await createDevAccountStatusSnapshot(input, selection),
    stateSnapshot: await createDevStateSnapshot(input, { session, deployedContract: deployedContracts[0] ?? null }),
    transactions: await createDevTransactionsSnapshot(input, session),
    deployedContracts,
    eventRecords: await createDevEventRecordsSnapshot(input, session),
    settings: createDevSettingsSnapshot(input),
    copyToSystemClipboard,
    onFunctionInputSubmit: async (submission) => {
      return await createFunctionInputPreview(input, submission, previewActionContexts, previewFollowups);
    },
    onConfirmedTxPreview: async (event) => {
      return await executeConfirmedTxPreview(input, event, previewActionContexts, previewFollowups);
    },
    onSourceFileSelect: createDevSourceFileSelectHandler(input),
    onStateSnapshotRequest: async (request) => {
      return await createDevStateSnapshot(input, request);
    },
    onStateDetailRequest: async (request) => {
      return await createDevStateRowDetailSnapshot(input, request);
    },
    onStateKeyBookChange: async (change, context) => {
      saveDevStateKeyBookChange(input, context?.networkName, change);
    },
    onTransactionsRequest: async (nextSession) => {
      return await createDevTransactionsSnapshot(input, nextSession);
    },
    onDeployedContractsRequest: async (nextSession, context) => {
      return await createDevDeployedContractsSnapshot(input, nextSession, context?.networkName);
    },
    onChainStatesRequest: (networkName) => {
      return createDevChainStateOptions(input, networkName);
    },
    onLocalChainAction: async (request) => {
      return await executeDevLocalChainAction(input, request);
    },
    onEventRecordsRequest: async (nextSession) => {
      return await createDevEventRecordsSnapshot(input, nextSession);
    },
    onSourcePreviewsRequest: async (nextSession) => {
      return sourcePreviewsForSession(nextSession);
    },
    onBuildRequest: async (nextSession) => {
      return await executeDevBuild(input, nextSession);
    },
    onAccountStatusRequest: async (selection) => {
      return await createDevAccountStatusSnapshot(input, selection);
    },
    onBlockWatchStart: createDevBlockWatchHandler(input),
    onTraceRequest: async (txHash) => createDevTrace(input, txHash),
    onSettingsChange: (change) => {
      return saveDevSettingsChange(input, change);
    },
  });
  return { exitCode: 0, stdout: "", stderr: "" };
}

function createDevEntryLaunchInput(
  input: RunDevCommandInput,
  previewActionContexts: Map<string, DevActionContext>,
  previewFollowups: Map<string, FunctionInputSubmission>,
): RunDevShellInput | null {
  return createEntryLaunchInput({
    cwd: input.cwd,
    onFunctionInputSubmit: async (submission) => {
      return await createFunctionInputPreview(input, submission, previewActionContexts, previewFollowups);
    },
    onConfirmedTxPreview: async (event) => {
      return await executeConfirmedTxPreview(input, event, previewActionContexts, previewFollowups);
    },
    onStateSnapshotRequest: async (request) => {
      return await createDevStateSnapshot(input, request);
    },
    onStateDetailRequest: async (request) => {
      return await createDevStateRowDetailSnapshot(input, request);
    },
    onStateKeyBookChange: async (change, context) => {
      saveDevStateKeyBookChange(input, context?.networkName, change);
    },
    onTransactionsRequest: async (session) => {
      return await createDevTransactionsSnapshot(input, session);
    },
    onDeployedContractsRequest: async (session, context) => {
      return await createDevDeployedContractsSnapshot(input, session, context?.networkName);
    },
    onChainStatesRequest: (networkName) => {
      return createDevChainStateOptions(input, networkName);
    },
    onLocalChainAction: async (request) => {
      return await executeDevLocalChainAction(input, request);
    },
    onEventRecordsRequest: async (session) => {
      return await createDevEventRecordsSnapshot(input, session);
    },
    onSourcePreviewsRequest: async (session) => {
      return sourcePreviewsForSession(session);
    },
    onBuildRequest: async (session) => {
      return await executeDevBuild(input, session);
    },
    onAccountStatusRequest: async (selection) => {
      return await createDevAccountStatusSnapshot(input, selection);
    },
    onBlockWatchStart: createDevBlockWatchHandler(input),
    onTraceRequest: async (txHash) => createDevTrace(input, txHash),
    onSettingsChange: (change) => {
      return saveDevSettingsChange(input, change);
    },
    ensureDevArtifact: async (prepared) => {
      await ensureDevArtifact(input, prepared);
    },
    locale: input.locale,
    networkOptions: devNetworkOptions(input),
    accountOptions: devAccountOptions(input),
    settings: createDevSettingsSnapshot(input),
    copyToSystemClipboard,
  });
}

function copyToSystemClipboard(text: string): void {
  const command = systemClipboardCommand(process.platform, process.env);
  if (command === null) {
    return;
  }

  try {
    const child = Bun.spawn([...command], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    child.stdin.write(text);
    child.stdin.end();
  } catch {
    // OSC52 remains the primary terminal clipboard path; system clipboard is a best-effort fallback.
  }
}

export function systemClipboardCommand(
  platform: string,
  env: Readonly<Record<string, string | undefined>>,
): readonly string[] | null {
  if (platform === "darwin") {
    return ["pbcopy"];
  }
  if (platform === "win32") {
    return ["clip.exe"];
  }
  if (platform === "linux") {
    if (env.WAYLAND_DISPLAY !== undefined) {
      return ["wl-copy"];
    }
    if (env.DISPLAY !== undefined) {
      return ["xclip", "-selection", "clipboard"];
    }
  }
  return null;
}

function createDevSourceFileSelectHandler(input: RunDevCommandInput): NonNullable<RunDevShellInput["onSourceFileSelect"]> {
  return createSourceFileSelectHandler({
    cwd: input.cwd,
    ensureDevArtifact: async (prepared) => {
      await ensureDevArtifact(input, prepared);
    },
  });
}

function createDevChainStateOptions(input: RunDevCommandInput, networkName: string): readonly DevChainStateOption[] {
  return listLocalChainStates(input, networkName).map((state) => ({
    name: state.name,
    label: state.name,
    description: `#${state.chain_id ?? "unknown"} ${state.network}`,
    createdAtUnix: state.created_at_unix,
  }));
}

async function executeDevLocalChainAction(
  input: RunDevCommandInput,
  request: DevLocalChainActionRequest,
): Promise<DevLocalChainActionResult> {
  if (request.action === "start") {
    const data = await startLocalChainData(input, request.networkName);
    return { status: "ok", message: chainStartMessage(data) };
  }
  if (request.action === "reset") {
    const data = await resetLocalChainData(input, request.networkName);
    return { status: "ok", message: chainStateActionMessage(data) };
  }
  if (request.stateName === undefined) {
    throw new ProjectError({
      code: "chain_state_name_required",
      message: "State name is required.",
      hint: "Enter a state name and try again.",
    });
  }
  if (request.action === "save_state") {
    const data = await saveLocalChainStateData(input, request.networkName, request.stateName);
    return { status: "ok", message: chainStateActionMessage(data) };
  }

  const data = await restoreLocalChainStateData(input, request.networkName, request.stateName);
  return { status: "ok", message: chainStateActionMessage(data) };
}

function chainStartMessage(data: ChainActionData): string {
  return data.action === "already_running" ? "chain already running" : "chain started";
}

function chainStateActionMessage(data: ChainStateActionData): string {
  if (data.action === "saved") {
    return `chain state saved${data.state === null ? "" : `: ${data.state.name}`}`;
  }
  if (data.action === "restored") {
    return `chain state restored${data.state === null ? "" : `: ${data.state.name}`}`;
  }
  return "chain reset";
}

async function createDevAccountStatusSnapshot(
  input: RunDevCommandInput,
  selection: DevRuntimeSelection,
): Promise<DevAccountStatusSnapshot> {
  const account = accountMetaFromSelector(loadConsolConfig(input.env), selection.accountName);
  try {
    const runtime = networkRuntimeForSelection(input, selection.networkName);
    if (runtime.meta.kind === "remote" && input.createRpcAdapter === undefined) {
      return {
        ...selection,
        address: account.address,
        signer: account.signer,
        balanceWei: null,
        balanceDisplay: null,
        balanceDetail: null,
        status: "error",
        message: "remote balance unavailable",
        accounts: devAccountMetas(input).map((meta) => accountStatusErrorEntry(meta, "remote balance unavailable")),
      };
    }
    const adapter = rpcAdapterForRuntime(input, runtime);
    const accounts = await Promise.all(devAccountMetas(input).map((meta) => accountStatusEntry(adapter, meta)));
    const active = accounts.find((entry) => entry.accountName === selection.accountName) ?? accountStatusErrorEntry(account, "balance unavailable");
    return { ...selection, ...active, accounts };
  } catch (error) {
    return {
      ...selection,
      address: null,
      signer: null,
      balanceWei: null,
      balanceDisplay: null,
      status: "error",
      message: errorMessage(error),
      accounts: devAccountMetas(input).map((meta) => accountStatusErrorEntry(meta, errorMessage(error))),
    };
  }
}

function devAccountMetas(input: RunDevCommandInput): readonly AccountMeta[] {
  const config = loadConsolConfig(input.env);
  return [
    ...defaultAnvilAccountMetas(),
    ...(input.env.ETH_PRIVATE_KEY === undefined ? [] : [{ name: "env", address: null, signer: "env-private-key" }]),
    ...Object.keys(config.accounts)
      .sort((left, right) => left.localeCompare(right))
      .map((name) => accountMetaFromSelector(config, name)),
  ];
}

async function accountStatusEntry(adapter: RpcAdapter, account: AccountMeta): Promise<DevAccountStatusEntry> {
  if (account.address === null) {
    return accountStatusErrorEntry(account, "address unavailable");
  }

  try {
    const wei = String(await adapter.getBalance(account.address));
    return {
      accountName: account.name,
      address: account.address,
      signer: account.signer,
      balanceWei: wei,
      balanceDisplay: formatNativeBalance(wei, "ETH"),
      balanceDetail: `${formatDecimalUnit(wei, 9, "gwei")} · ${wei} wei`,
      status: "ok",
      message: null,
    };
  } catch (error) {
    return accountStatusErrorEntry(account, errorMessage(error));
  }
}

function accountStatusErrorEntry(account: AccountMeta, message: string): DevAccountStatusEntry {
  return {
    accountName: account.name,
    address: account.address,
    signer: account.signer,
    balanceWei: null,
    balanceDisplay: null,
    balanceDetail: null,
    status: "error",
    message,
  };
}

function initialRuntimeSelection(input: RunDevCommandInput): DevRuntimeSelection {
  const config = loadConsolConfig(input.env);
  return {
    networkName: input.globals.network ?? config.active_network ?? "local",
    accountName:
      input.globals.account ??
      input.globals.signer ??
      config.active_account ??
      (input.env.ETH_PRIVATE_KEY === undefined ? "anvil0" : "env"),
  };
}

function createDevSettingsSnapshot(input: RunDevCommandInput): DevSettingsSnapshot {
  const config = loadConsolConfig(input.env);
  const language = normalizeLocale(config.ui?.language) ?? "system";
  return {
    language,
    resolvedLocale: input.locale,
    systemLocale: resolveLocale({ configuredLanguage: "system", env: input.env }),
    showRawStateValues: config.ui?.show_raw_state_values ?? true,
    hideNoArgReadActions: config.ui?.hide_no_arg_read_actions ?? false,
    configPath: resolveConfigPaths({ env: input.env }).configPath,
  };
}

function saveDevSettingsChange(input: RunDevCommandInput, change: DevSettingsChange) {
  const current = createDevSettingsSnapshot(input);
  const language = change.language ?? current.language;
  const showRawStateValues = change.showRawStateValues ?? current.showRawStateValues;
  const hideNoArgReadActions = change.hideNoArgReadActions ?? current.hideNoArgReadActions;
  const configPath = saveUiSettings({
    env: input.env,
    language,
    showRawStateValues,
    hideNoArgReadActions,
  });
  return {
    language,
    resolvedLocale: resolveLocale({ configuredLanguage: language, env: input.env }),
    showRawStateValues,
    hideNoArgReadActions,
    configPath,
  };
}

function formatNativeBalance(wei: string, symbol: string): string {
  return formatDecimalUnit(wei, 18, symbol, 4);
}

export function formatDecimalUnit(wei: string, decimals: number, symbol: string, maxFractionDigits = 4): string {
  const value = wei.trim();
  if (!/^[0-9]+$/.test(value)) {
    return `${value} wei`;
  }

  const padded = value.padStart(decimals + 1, "0");
  const whole = (decimals === 0 ? value : padded.slice(0, -decimals)).replace(/^0+(?=\d)/, "");
  const fraction = decimals === 0 ? "" : padded.slice(-decimals).replace(/0+$/, "").slice(0, maxFractionDigits);
  return `${whole}${fraction.length === 0 ? "" : `.${fraction}`} ${symbol}`;
}

function devDirectoryTargetInput(input: RunDevCommandInput): RunDevCommandInput | null {
  const targetIndex = commandTargetIndex(input.commandArgs);
  if (targetIndex < 0 || input.globals.project !== undefined) {
    return null;
  }

  const target = input.commandArgs[targetIndex];
  if (target === undefined || target.includes(".sol")) {
    return null;
  }

  const directory = findDevDirectory(input.cwd, target);
  if (directory === null) {
    return null;
  }

  return {
    ...input,
    cwd: directory,
    commandArgs: input.commandArgs.filter((_, index) => index !== targetIndex),
  };
}

function devSessionWithWorkspaceRoot(session: DevSession, prepared: ResolvedDevSession): DevSession {
  if (session.sourceMode !== "single_file" || prepared.resolved.sourceFile === undefined) {
    return session;
  }

  return { ...session, workspaceRoot: dirname(prepared.resolved.sourceFile) };
}
