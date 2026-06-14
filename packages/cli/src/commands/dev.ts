import {
  activeAccountMeta,
  activeNetworkRuntime,
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
  type ResolvedTarget,
} from "@consol/core";
import { runCastCall, runCastCalldata, runCastEstimate } from "@consol/foundry";
import type { RpcAdapter } from "@consol/rpc";
import { dirname } from "node:path";
import {
  runDevShell,
  type DevAccountStatusEntry,
  type ConfirmedTxPreviewResult,
  type DevAccountStatusSnapshot,
  type DevContractEventRecord,
  type DevChainStateOption,
  type DevRuntimeSelection,
  type DevSettingsChange,
  type DevSettingsSnapshot,
  type DevLocalChainActionRequest,
  type DevLocalChainActionResult,
  type DevTransactionRecord,
  type FunctionInputSubmission,
  type RunDevShellInput,
} from "@consol/tui";
import { normalizeLocale, resolveLocale, type Locale } from "@consol/i18n";
import { createSuccessEnvelope } from "@consol/protocol";
import type { AccountMeta, NetworkMeta, TxPreviewEvent } from "@consol/protocol";
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
import { createDeployGasPreview } from "./dev-deploy-gas-preview";
import { ensureDevArtifact, executeDevBuild } from "./dev-artifact";
import { createDevStateRowDetailSnapshot, createDevStateSnapshot, saveDevStateKeyBookChange } from "./dev-state";
import { createDevJsonSnapshot } from "./dev-json";
import { devAccountOptions, devNetworkOptions } from "./dev-options";
import { devSessionActionContext } from "./dev-session-context";
import { accountMetaForSubmission, actionGlobalsForSubmission, gasLimitArgs, sessionActionGlobals } from "./dev-submission-context";
import { sourcePreviewsForSession } from "./dev-source-preview";
import { commandTarget, commandTargetIndex, findDevDirectory, preferredDevTarget } from "./dev-target";
import { runDeployCommand } from "./deploy";
import { createReadContext } from "./interact-context";
import { runSendCommand } from "./send";
import { createDevDeployedContractsSnapshot } from "./dev-deployments";
import { createDevTrace } from "./dev-trace";
import { createDevBlockWatchHandler } from "./dev-event-watch";
import { enrichRevertError } from "./dev-revert";
import { networkRuntimeForSelection, rpcAdapterForNetwork, rpcAdapterForRuntime, type CreateDevRpcAdapter } from "./dev-runtime";
import {
  arrayFromUnknown,
  errorMessage,
  eventCreatedAtUnix,
  nullableScalarStringFromUnknown,
  nullableStringFromUnknown,
  numberFromUnknown,
  rawEventString,
  recordFromUnknown,
  stringFromUnknown,
} from "./dev-unknown";
import { createDevEventRecordsSnapshot, createDevTransactionsSnapshot, devContractEventArgFromUnknown, logLinesFromUnknown } from "./dev-records";

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

type DevActionContext = {
  readonly cwd: string;
  readonly target: string;
  readonly address?: string;
  readonly globals?: GlobalArgs;
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

async function executeConfirmedTxPreview(
  input: RunDevCommandInput,
  event: TxPreviewEvent,
  previewActionContexts: Map<string, DevActionContext>,
  previewFollowups: Map<string, FunctionInputSubmission>,
): Promise<ConfirmedTxPreviewResult> {
  const actionContext = previewActionContexts.get(event.id);
  const followup = previewFollowups.get(event.id);
  previewFollowups.delete(event.id);
  const commandInput = {
    globals: actionContext?.globals ?? (actionContext === undefined ? input.globals : sessionActionGlobals(input.globals)),
    cwd: actionContext?.cwd ?? input.cwd,
    env: input.env,
  };
  if (event.action === "read") {
    const target = actionContext?.target ?? event.target.display;
    return await executeReadPreview(
      {
        ...commandInput,
        ensureArtifact: async (resolved) => {
          await ensureDevArtifact(input, { target, resolved });
        },
      },
      event,
      target,
      actionContext?.address,
    );
  }

  if (event.action === "send") {
    const target = actionContext?.target ?? event.target.display;
    return await confirmedResult(
      input,
      event,
      await runSendCommand({
        ...commandInput,
        globals: { ...commandInput.globals, json: true },
        ensureArtifact: async (resolved) => {
          await ensureDevArtifact(input, { target, resolved });
        },
        commandArgs: [
          target,
          event.calldata.signature ?? event.calldata.function,
          ...event.calldata.args,
          ...(actionContext?.address === undefined ? [] : ["--address", actionContext.address]),
          ...(event.value === undefined || event.value === null ? [] : ["--value", event.value]),
          ...gasLimitArgs(event),
        ],
      }),
    );
  }

  let deployCommandResult: CliResult;
  try {
    deployCommandResult = await runDeployCommand({
      ...commandInput,
      globals: { ...commandInput.globals, json: true },
      commandArgs: [
        actionContext?.target ?? event.target.display,
        ...(actionContext !== undefined ? ["--fresh"] : []),
        ...(event.value === undefined || event.value === null ? [] : ["--value", event.value]),
        ...gasLimitArgs(event),
        ...event.calldata.args,
      ],
    });
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }

  const deployResult = await confirmedResult(input, event, deployCommandResult);
  if (deployResult.status !== "ok" || followup === undefined) {
    return deployResult;
  }

  const next = await createFunctionInputPreview(input, followup, previewActionContexts, previewFollowups);
  if (isTxPreviewEvent(next)) {
    return { ...deployResult, nextPreview: next };
  }

  return {
    status: next.status,
    message: `${deployResult.message}\n${next.message}`,
    ...(next.nextPreview === undefined ? {} : { nextPreview: next.nextPreview }),
  };
}

async function executeReadPreview(
  input: {
    readonly globals: GlobalArgs;
    readonly cwd: string;
    readonly env: CliEnv;
    readonly ensureArtifact?: (resolved: ResolvedTarget) => Promise<void>;
  },
  event: TxPreviewEvent,
  target: string,
  addressOverride?: string,
): Promise<ConfirmedTxPreviewResult> {
  const context = await createReadContext({
    globals: input.globals,
    cwd: input.cwd,
    env: input.env,
    target,
    ...(addressOverride === undefined ? {} : { addressOverride }),
    ...(input.ensureArtifact === undefined ? {} : { ensureArtifact: input.ensureArtifact }),
  });
  const signature = event.calldata.signature ?? event.calldata.function;
  const address = addressOverride ?? context.address;
  const call = await runCastCall({
    cwd: context.resolved.projectRoot,
    env: input.env,
    rpcUrl: context.rpc_url,
    address,
    signature,
    args: event.calldata.args,
  });

  return {
    status: call.ok ? "ok" : "error",
    message: call.ok
      ? `${context.resolved.contractName} ${signature} -> ${call.stdout.trim()}`
      : `cast call failed for ${signature}.`,
  };
}

async function confirmedResult(
  input: RunDevCommandInput,
  event: TxPreviewEvent,
  result: CliResult,
): Promise<ConfirmedTxPreviewResult> {
  const parsed = parseSuccessEnvelope(result.stdout);
  const data = recordFromUnknown(parsed?.["data"]);
  const meta = recordFromUnknown(parsed?.["meta"]);
  const txHash = nullableStringFromUnknown(data?.["tx_hash"]);
  const base: ConfirmedTxPreviewResult = {
    status: result.exitCode === 0 ? "ok" : "error",
    message: confirmedResultMessage(event, result, data),
    ...(txHash === null || (input.createRpcAdapter === undefined && !isFullTransactionHash(txHash)) ? {} : { txHash }),
  };
  if (base.status !== "ok") {
    return base;
  }

  return await enrichConfirmedResult(input, event, base, data, meta, result.stdout);
}

function parseSuccessEnvelope(stdout: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const envelope = recordFromUnknown(parsed);
    return envelope?.["ok"] === true ? envelope : undefined;
  } catch {
    return undefined;
  }
}

function confirmedResultMessage(event: TxPreviewEvent, result: CliResult, data: Record<string, unknown> | undefined): string {
  if (data !== undefined && event.action === "send") {
    const contract = stringFromUnknown(data["contract"]) ?? event.target.contract;
    const signature = stringFromUnknown(data["signature"]) ?? event.calldata.signature ?? event.calldata.function;
    const txHash = nullableStringFromUnknown(data["tx_hash"]);
    return `${contract} ${signature} -> ${txHash ?? "submitted"}`;
  }

  if (data !== undefined && event.action === "deploy") {
    const contract = stringFromUnknown(data["contract"]) ?? event.target.contract;
    const address = stringFromUnknown(data["address"]) ?? "submitted";
    const cached = data["cached"] === true ? " (cached)" : "";
    return `${contract} deployed at ${address}${cached}`;
  }

  return result.stdout.trim() || result.stderr.trim() || `exit ${result.exitCode}`;
}

async function enrichConfirmedResult(
  input: RunDevCommandInput,
  event: TxPreviewEvent,
  result: ConfirmedTxPreviewResult,
  data: Record<string, unknown> | undefined,
  meta: Record<string, unknown> | undefined,
  rawOutput: string,
): Promise<ConfirmedTxPreviewResult> {
  const txHash = result.txHash ?? txHashFromText(result.message);
  if (txHash === null || txHash === undefined) {
    return result;
  }
  if (input.createRpcAdapter === undefined && !isFullTransactionHash(txHash)) {
    return { ...result, txHash };
  }

  const network = networkMetaFromUnknown(meta?.["network"]) ?? activeNetworkRuntime(input.env).meta;
  const account = accountMetaFromUnknown(meta?.["account"]) ?? activeAccountMeta(input.env);
  const adapter = rpcAdapterForNetwork(input, network);
  try {
    const receipt = await adapter.waitForTransactionReceipt(txHash);
    const transaction = await adapter.getTransaction(txHash).catch(() => undefined);
    const receiptRecord = recordFromUnknown(receipt);
    const minedBlockNumber = bigintFromUnknown(receiptRecord?.["blockNumber"] ?? receiptRecord?.["block_number"]);
    const minedBlock = minedBlockNumber === null ? undefined : await adapter.getBlock({ blockNumber: minedBlockNumber }).catch(() => undefined);
    const latestBlock = await adapter.getBlock({ blockTag: "latest" }).catch(() => undefined);
    return {
      ...result,
      txHash,
      transaction: rpcTransactionRecord({
        event,
        result,
        txHash,
        data,
        receipt,
        transaction,
        minedBlock,
        latestBlock,
        network,
        account,
        rawOutput,
      }),
    };
  } catch {
    return { ...result, txHash };
  }
}

function rpcTransactionRecord(input: {
  readonly event: TxPreviewEvent;
  readonly result: ConfirmedTxPreviewResult;
  readonly txHash: string;
  readonly data: Record<string, unknown> | undefined;
  readonly receipt: unknown;
  readonly transaction: unknown;
  readonly minedBlock: unknown;
  readonly latestBlock: unknown;
  readonly network: NetworkMeta;
  readonly account: AccountMeta;
  readonly rawOutput: string;
}): DevTransactionRecord {
  const receipt = recordFromUnknown(input.receipt);
  const transaction = recordFromUnknown(input.transaction);
  const minedBlock = recordFromUnknown(input.minedBlock);
  const latestBlock = recordFromUnknown(input.latestBlock);
  const receiptBlockNumber = bigintFromUnknown(receipt?.["blockNumber"] ?? receipt?.["block_number"]);
  const latestBlockNumber = bigintFromUnknown(latestBlock?.["number"] ?? latestBlock?.["blockNumber"]);
  return {
    id: input.txHash,
    action: input.event.action,
    contract: input.event.target.contract,
    target: input.event.target.display,
    functionName: input.event.calldata.function,
    signature: input.event.calldata.signature ?? input.event.calldata.function,
    args: input.event.calldata.args,
    result: input.result.message,
    rawOutput: input.rawOutput,
    txHash: input.txHash,
    blockNumber: receiptBlockNumber === null ? null : String(receiptBlockNumber),
    confirmations: confirmationCount(receiptBlockNumber, latestBlockNumber),
    status: receiptStatus(receipt?.["status"]),
    gasUsed: nullableScalarStringFromUnknown(receipt?.["gasUsed"] ?? receipt?.["gas_used"]),
    gasLimit: nullableScalarStringFromUnknown(transaction?.["gas"] ?? transaction?.["gasLimit"] ?? transaction?.["gas_limit"]),
    network: input.network.name,
    chainId: input.network.chain_id === null ? null : String(input.network.chain_id),
    networkFingerprint: input.network.fingerprint,
    account: input.account.name,
    address: nullableStringFromUnknown(input.data?.["address"]),
    from: nullableStringFromUnknown(transaction?.["from"]) ?? input.account.address,
    to: nullableStringFromUnknown(transaction?.["to"]) ?? nullableStringFromUnknown(input.data?.["address"]),
    signerAddress: nullableStringFromUnknown(input.data?.["signer_address"]) ?? input.account.address,
    nonce: nullableScalarStringFromUnknown(transaction?.["nonce"]) ?? nullableScalarStringFromUnknown(input.data?.["nonce"]),
    gasPrice: nullableScalarStringFromUnknown(transaction?.["gasPrice"] ?? transaction?.["gas_price"]) ?? nullableScalarStringFromUnknown(input.data?.["gas_price"]),
    maxFeePerGas: nullableScalarStringFromUnknown(transaction?.["maxFeePerGas"] ?? transaction?.["max_fee_per_gas"]),
    maxPriorityFeePerGas: nullableScalarStringFromUnknown(transaction?.["maxPriorityFeePerGas"] ?? transaction?.["max_priority_fee_per_gas"]),
    effectiveGasPrice: nullableScalarStringFromUnknown(receipt?.["effectiveGasPrice"] ?? receipt?.["effective_gas_price"]),
    contractAddress: nullableStringFromUnknown(receipt?.["contractAddress"] ?? receipt?.["contract_address"]),
    gasEstimate: nullableScalarStringFromUnknown(input.data?.["gas_estimate"]) ?? (input.event.gas.estimate === undefined ? null : String(input.event.gas.estimate)),
    gasEstimateError: nullableScalarStringFromUnknown(input.data?.["gas_estimate_error"]),
    calldataHash: nullableStringFromUnknown(input.data?.["calldata_hash"]),
    calldataPrefix: nullableStringFromUnknown(input.data?.["calldata_prefix"]) ?? (input.event.calldata.hex.length <= 42 ? input.event.calldata.hex : `${input.event.calldata.hex.slice(0, 42)}...`),
    input: nullableStringFromUnknown(transaction?.["input"]),
    logs: logLinesFromUnknown(receipt?.["logs"]),
    events: eventRecordsFromReceiptLogs({
      logs: receipt?.["logs"],
      event: input.event,
      createdAtUnix: eventCreatedAtUnix(input.event.timestamp),
    }),
    value: nullableScalarStringFromUnknown(transaction?.["value"]) ?? input.event.value ?? null,
    blockTimestamp: nullableScalarStringFromUnknown(minedBlock?.["timestamp"]),
    createdAtUnix: eventCreatedAtUnix(input.event.timestamp),
  };
}

function eventRecordsFromReceiptLogs(input: {
  readonly logs: unknown;
  readonly event: TxPreviewEvent;
  readonly createdAtUnix: number;
}): readonly DevContractEventRecord[] {
  return arrayFromUnknown(input.logs).map((log, index) => {
    const record = recordFromUnknown(log);
    const txHash = nullableStringFromUnknown(record?.["transactionHash"] ?? record?.["transaction_hash"]);
    const logIndex = nullableScalarStringFromUnknown(record?.["logIndex"] ?? record?.["log_index"]) ?? String(index);
    return {
      id: `${txHash ?? input.event.id}:${logIndex}`,
      source: "receipt",
      contract: input.event.target.contract,
      address: nullableStringFromUnknown(record?.["address"]) ?? nullableStringFromUnknown(record?.["to"]),
      event: nullableStringFromUnknown(record?.["event"]) ?? nullableStringFromUnknown(record?.["name"]),
      signature: nullableStringFromUnknown(record?.["signature"]),
      args: arrayFromUnknown(record?.["args"]).map(devContractEventArgFromUnknown),
      raw: rawEventString(log),
      txHash,
      blockNumber: nullableScalarStringFromUnknown(record?.["blockNumber"] ?? record?.["block_number"]),
      logIndex,
      createdAtUnix: input.createdAtUnix,
    };
  });
}

function networkMetaFromUnknown(raw: unknown): NetworkMeta | null {
  const record = recordFromUnknown(raw);
  const name = stringFromUnknown(record?.["name"]);
  const kind = stringFromUnknown(record?.["kind"]);
  const rpcUrl = stringFromUnknown(record?.["rpc_url"]);
  const writePolicy = stringFromUnknown(record?.["write_policy"]);
  if (name === undefined || kind === undefined || rpcUrl === undefined || writePolicy === undefined) {
    return null;
  }

  return {
    name,
    kind,
    chain_id: numberFromUnknown(record?.["chain_id"]) ?? null,
    rpc_url: rpcUrl,
    fork_url: nullableStringFromUnknown(record?.["fork_url"]),
    fork_block_number: numberFromUnknown(record?.["fork_block_number"]) ?? null,
    fingerprint: nullableStringFromUnknown(record?.["fingerprint"]),
    write_policy: writePolicy,
  };
}

function accountMetaFromUnknown(raw: unknown): AccountMeta | null {
  const record = recordFromUnknown(raw);
  const name = stringFromUnknown(record?.["name"]);
  const signer = stringFromUnknown(record?.["signer"]);
  if (name === undefined || signer === undefined) {
    return null;
  }

  return {
    name,
    address: nullableStringFromUnknown(record?.["address"]),
    signer,
  };
}

function receiptStatus(raw: unknown): string | null {
  if (raw === "success" || raw === "0x1" || raw === 1 || raw === 1n || raw === true) {
    return "success";
  }
  if (raw === "reverted" || raw === "0x0" || raw === 0 || raw === 0n || raw === false) {
    return "reverted";
  }
  return nullableScalarStringFromUnknown(raw);
}

function confirmationCount(receiptBlockNumber: bigint | null, latestBlockNumber: bigint | null): string | null {
  if (receiptBlockNumber === null || latestBlockNumber === null || latestBlockNumber < receiptBlockNumber) {
    return null;
  }

  return String(latestBlockNumber - receiptBlockNumber + 1n);
}

function bigintFromUnknown(raw: unknown): bigint | null {
  if (typeof raw === "bigint") {
    return raw;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return BigInt(Math.trunc(raw));
  }
  if (typeof raw !== "string") {
    return null;
  }

  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

function isFullTransactionHash(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function txHashFromText(value: string): string | null {
  const match = value.match(/0x[a-fA-F0-9]{64}/);
  return match?.[0] ?? null;
}

async function createFunctionInputPreview(
  input: RunDevCommandInput,
  submission: FunctionInputSubmission,
  previewActionContexts: Map<string, DevActionContext>,
  previewFollowups: Map<string, FunctionInputSubmission>,
): Promise<TxPreviewEvent | ConfirmedTxPreviewResult> {
  if (submission.action === "read") {
    try {
      return await createReadInputPreview(input, submission, previewActionContexts);
    } catch (error) {
      if (shouldDeployBeforeFunction(error)) {
        return await createDeployBeforeFunctionPreview(input, submission, previewActionContexts, previewFollowups);
      }
      throw error;
    }
  }

  if (submission.action === "deploy" || submission.action === "redeploy") {
    assertDeployableSession(submission.session);
    const sessionContext = devSessionActionContext(submission.session);
    const actionCwd = submission.cwdOverride ?? sessionContext.cwd;
    const actionTarget = submission.targetOverride ?? sessionContext.target;
    const actionGlobals = actionGlobalsForSubmission(input.globals, submission);
    const event = await createDeployInputPreview(input, submission, {
      cwd: actionCwd,
      target: actionTarget,
      globals: actionGlobals,
    });
    previewActionContexts.set(event.id, {
      cwd: actionCwd,
      target: actionTarget,
      globals: actionGlobals,
    });
    return event;
  }

  const sessionContext = devSessionActionContext(submission.session);
  const actionCwd = submission.cwdOverride ?? sessionContext.cwd;
  const actionGlobals = actionGlobalsForSubmission(input.globals, submission);
  const context = await createReadContext({
    globals: actionGlobals,
    cwd: actionCwd,
    env: input.env,
    target: submission.targetOverride ?? sessionContext.target,
    ...(submission.addressOverride === undefined ? {} : { addressOverride: submission.addressOverride }),
    ensureArtifact: async (resolved) => {
      await ensureDevArtifact(input, { target: submission.targetOverride ?? sessionContext.target, resolved });
    },
  }).catch((error: unknown) => {
    if (shouldDeployBeforeFunction(error)) {
      return null;
    }
    throw error;
  });
  if (context === null) {
    return await createDeployBeforeFunctionPreview(input, submission, previewActionContexts, previewFollowups);
  }
  const calldata = await runCastCalldata({
    cwd: context.resolved.projectRoot,
    env: input.env,
    signature: submission.function.signature,
    args: submission.args,
  });
  if (!calldata.ok) {
    throw new ProjectError({
      code: "calldata_preview_failed",
      message: `Failed to encode calldata for ${submission.function.signature}.`,
      hint: calldata.stderr.trim() || calldata.stdout.trim() || calldata.error,
    });
  }

  const gas = await runCastEstimate({
    cwd: context.resolved.projectRoot,
    env: input.env,
    rpcUrl: context.rpc_url,
    address: submission.addressOverride ?? context.address,
    signature: submission.function.signature,
    args: submission.args,
    ...(context.account.address === null ? {} : { from: context.account.address }),
    ...(submission.value === null ? {} : { value: submission.value }),
  });
  const event: TxPreviewEvent = {
    type: "tx.preview",
    id: `function-preview-${Date.now()}`,
    timestamp: new Date().toISOString(),
    action: "send",
    network: txPreviewNetwork(context.network),
    account: txPreviewAccount(context.account),
    signer: txPreviewSigner(context.account),
    target: {
      display: submission.targetOverride ?? submission.session.target,
      contract: submission.contractOverride ?? submission.session.contract,
      sourceMode: submission.session.sourceMode,
      ...(submission.session.sourceFile == null ? {} : { sourceFile: submission.session.sourceFile }),
    },
    calldata: {
      function: submission.function.name,
      signature: submission.function.signature,
      args: [...submission.args],
      hex: calldata.stdout.trim(),
    },
    ...(submission.value === null ? {} : { value: submission.value }),
    gas: {
      source: "rpc_estimate",
      ...(gas.ok ? { estimate: gas.stdout.trim() } : {}),
      confidence: gas.ok ? "medium" : "low",
      context: {
        ...(submission.gasLimit == null ? {} : { gasLimit: submission.gasLimit }),
        ...(gas.ok ? {} : { error: enrichRevertError(gas.stderr.trim() || gas.stdout.trim() || gas.error, submission.session) }),
      },
    },
  };
  previewActionContexts.set(event.id, {
    ...sessionContext,
    cwd: actionCwd,
    target: submission.targetOverride ?? sessionContext.target,
    ...(submission.addressOverride === undefined ? {} : { address: submission.addressOverride }),
    globals: actionGlobals,
  });
  return event;
}

function assertDeployableSession(session: DevSession): void {
  if (session.deployable !== false) {
    return;
  }

  throw new ProjectError({
    code: "dev_target_not_deployable",
    message: `${session.contract} cannot be deployed from the TUI.`,
    hint: session.deployReason ?? "Select a concrete contract with deployable bytecode.",
  });
}

async function createReadInputPreview(
  input: RunDevCommandInput,
  submission: FunctionInputSubmission,
  previewActionContexts: Map<string, DevActionContext>,
): Promise<TxPreviewEvent> {
  const sessionContext = devSessionActionContext(submission.session);
  const actionCwd = submission.cwdOverride ?? sessionContext.cwd;
  const actionGlobals = actionGlobalsForSubmission(input.globals, submission);
  const context = await createReadContext({
    globals: actionGlobals,
    cwd: actionCwd,
    env: input.env,
    target: submission.targetOverride ?? sessionContext.target,
    ...(submission.addressOverride === undefined ? {} : { addressOverride: submission.addressOverride }),
    ensureArtifact: async (resolved) => {
      await ensureDevArtifact(input, { target: submission.targetOverride ?? sessionContext.target, resolved });
    },
  });
  const calldata = await runCastCalldata({
    cwd: context.resolved.projectRoot,
    env: input.env,
    signature: submission.function.signature,
    args: submission.args,
  });
  if (!calldata.ok) {
    throw new ProjectError({
      code: "calldata_preview_failed",
      message: `Failed to encode calldata for ${submission.function.signature}.`,
      hint: calldata.stderr.trim() || calldata.stdout.trim() || calldata.error,
    });
  }

  const event: TxPreviewEvent = {
    type: "tx.preview",
    id: `read-preview-${Date.now()}`,
    timestamp: new Date().toISOString(),
    action: "read",
    network: txPreviewNetwork(context.network),
    account: txPreviewAccount(context.account),
    signer: txPreviewSigner(context.account),
    target: {
      display: submission.targetOverride ?? submission.session.target,
      contract: submission.contractOverride ?? submission.session.contract,
      sourceMode: submission.session.sourceMode,
      ...(submission.session.sourceFile == null ? {} : { sourceFile: submission.session.sourceFile }),
    },
    calldata: {
      function: submission.function.name,
      signature: submission.function.signature,
      args: [...submission.args],
      hex: calldata.stdout.trim(),
    },
    ...(submission.value === null ? {} : { value: submission.value }),
    gas: {
      source: "rpc_estimate",
      confidence: "low",
      context: { note: "read_call" },
    },
  };
  previewActionContexts.set(event.id, {
    ...sessionContext,
    cwd: actionCwd,
    target: submission.targetOverride ?? sessionContext.target,
    ...(submission.addressOverride === undefined ? {} : { address: submission.addressOverride }),
    globals: actionGlobals,
  });
  return event;
}

async function createDeployBeforeFunctionPreview(
  input: RunDevCommandInput,
  submission: FunctionInputSubmission,
  previewActionContexts: Map<string, DevActionContext>,
  previewFollowups: Map<string, FunctionInputSubmission>,
): Promise<TxPreviewEvent> {
  assertDeployableSession(submission.session);

  if ((submission.session.constructor?.inputs.length ?? 0) > 0) {
    throw new ProjectError({
      code: "dev_deploy_constructor_args_required",
      message: `${submission.session.contract} must be deployed before ${submission.function.signature}.`,
      hint: "Press d and enter constructor arguments before running this function.",
    });
  }

  const sessionContext = devSessionActionContext(submission.session);
  const actionCwd = submission.cwdOverride ?? sessionContext.cwd;
  const actionGlobals = actionGlobalsForSubmission(input.globals, submission);
  const event = await createDeployInputPreview(input, {
    action: "deploy",
    session: submission.session,
    function: deploymentFunction(submission.session),
    args: [],
    value: null,
    ...(submission.gasLimit == null ? {} : { gasLimit: submission.gasLimit }),
    ...(submission.accountName === undefined ? {} : { accountName: submission.accountName }),
    ...(submission.networkName === undefined ? {} : { networkName: submission.networkName }),
    ...(submission.cwdOverride === undefined ? {} : { cwdOverride: submission.cwdOverride }),
  }, {
    cwd: actionCwd,
    target: sessionContext.target,
    globals: actionGlobals,
  });
  const followupCalldata = await runCastCalldata({
    cwd: actionCwd,
    env: input.env,
    signature: submission.function.signature,
    args: submission.args,
  });
  if (!followupCalldata.ok) {
    throw new ProjectError({
      code: "calldata_preview_failed",
      message: `Failed to encode calldata for ${submission.function.signature}.`,
      hint: followupCalldata.stderr.trim() || followupCalldata.stdout.trim() || followupCalldata.error,
    });
  }

  const eventWithFollowup: TxPreviewEvent = {
    ...event,
    followup: {
      action: submission.action === "read" ? "read" : "send",
      calldata: {
        function: submission.function.name,
        signature: submission.function.signature,
        args: [...submission.args],
        hex: followupCalldata.stdout.trim(),
      },
      ...(submission.value === null ? {} : { value: submission.value }),
      ...(submission.action === "send"
        ? {
            gas: {
              source: "rpc_estimate",
              confidence: "low",
              context: {
                note: "estimate_after_deploy",
                ...(submission.gasLimit == null ? {} : { gasLimit: submission.gasLimit }),
              },
            },
          }
        : {}),
    },
  };
  previewActionContexts.set(eventWithFollowup.id, { ...sessionContext, cwd: actionCwd, globals: actionGlobals });
  previewFollowups.set(eventWithFollowup.id, submission);
  return eventWithFollowup;
}

function isTxPreviewEvent(value: TxPreviewEvent | ConfirmedTxPreviewResult): value is TxPreviewEvent {
  return "type" in value && value.type === "tx.preview";
}

function shouldDeployBeforeFunction(error: unknown): boolean {
  return error instanceof ProjectError && (error.code === "deployment_not_found" || error.code === "deployment_stale");
}

function deploymentFunction(session: DevSession): FunctionInputSubmission["function"] {
  return {
    name: "constructor",
    signature: session.constructor?.signature ?? "constructor()",
    state_mutability: session.constructor?.state_mutability ?? "nonpayable",
    kind: session.constructor?.state_mutability === "payable" ? "payable" : "write",
    inputs: session.constructor?.inputs ?? [],
    outputs: [],
  };
}

async function createDeployInputPreview(
  input: RunDevCommandInput,
  submission: FunctionInputSubmission,
  actionContext: Pick<DevActionContext, "cwd" | "target" | "globals">,
): Promise<TxPreviewEvent> {
  const activeRuntime = activeNetworkRuntime(input.env);
  const networkRuntime = submission.networkName === undefined
    ? { meta: activeRuntime.meta, rpcUrl: activeRuntime.rpc_url }
    : networkRuntimeForSelection(input, submission.networkName);
  const account = accountMetaForSubmission(input.env, input.globals, submission);
  const gas = await createDeployGasPreview({
    env: input.env,
    cwd: actionContext.cwd,
    target: actionContext.target,
    ...(actionContext.globals === undefined ? {} : { globals: actionContext.globals }),
    rpcUrl: networkRuntime.rpcUrl,
    account,
    action: submission.action === "redeploy" ? "redeploy" : "deploy",
    signature: submission.function.signature,
    args: submission.args,
    value: submission.value,
    ...(submission.gasLimit == null ? {} : { gasLimit: submission.gasLimit }),
  });
  return {
    type: "tx.preview",
    id: `deploy-preview-${Date.now()}`,
    timestamp: new Date().toISOString(),
    action: "deploy",
    network: txPreviewNetwork(networkRuntime.meta),
    account: txPreviewAccount(account),
    signer: txPreviewSigner(account),
    target: {
      display: submission.session.target,
      contract: submission.session.contract,
      sourceMode: submission.session.sourceMode,
      ...(submission.session.sourceFile == null ? {} : { sourceFile: submission.session.sourceFile }),
    },
    calldata: {
      function: submission.function.name,
      signature: submission.function.signature,
      args: [...submission.args],
      hex: "0x",
    },
    ...(submission.value === null ? {} : { value: submission.value }),
    gas,
  };
}

function txPreviewNetwork(network: NetworkMeta): TxPreviewEvent["network"] {
  if (network.chain_id === null) {
    throw new ProjectError({
      code: "network_chain_id_missing",
      message: `Network ${network.name} is missing chain id for transaction preview.`,
      hint: "Set chain_id on the network profile before sending from the TUI.",
    });
  }

  return {
    name: network.name,
    chainId: network.chain_id,
    fingerprint: network.fingerprint ?? network.name,
    writePolicy: txPreviewWritePolicy(network.write_policy),
  };
}

function txPreviewAccount(account: AccountMeta): TxPreviewEvent["account"] {
  if (account.address === null) {
    throw new ProjectError({
      code: "account_address_missing",
      message: `Account ${account.name} is missing an address for transaction preview.`,
      hint: "Select an account profile with an address while TUI signer derivation is being wired.",
    });
  }

  return {
    name: account.name,
    address: account.address,
  };
}

function txPreviewSigner(account: AccountMeta): TxPreviewEvent["signer"] {
  return {
    name: account.name,
    source: txPreviewSignerSource(account.signer),
    ...(account.address === null ? {} : { address: account.address }),
    available: account.address !== null,
  };
}

function txPreviewWritePolicy(value: string): TxPreviewEvent["network"]["writePolicy"] {
  switch (value) {
    case "local":
    case "confirm":
    case "typed-confirm":
    case "read-only":
      return value;
    default:
      return "confirm";
  }
}

function txPreviewSignerSource(value: string): TxPreviewEvent["signer"]["source"] {
  switch (value) {
    case "anvil-index":
    case "env-private-key":
    case "keystore":
      return value;
    default:
      return "unknown";
  }
}

function devSessionWithWorkspaceRoot(session: DevSession, prepared: ResolvedDevSession): DevSession {
  if (session.sourceMode !== "single_file" || prepared.resolved.sourceFile === undefined) {
    return session;
  }

  return { ...session, workspaceRoot: dirname(prepared.resolved.sourceFile) };
}
