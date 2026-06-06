import {
  activeAccountMeta,
  activeNetworkRuntime,
  addStateKey,
  accountMetaFromSelector,
  createDevSessionFromResolved,
  defaultAnvilAccountMetas,
  deleteStateKey,
  loadConsolConfig,
  networkMetaFromProfile,
  networkProfiles,
  ProjectError,
  readStateKeyBook,
  readContractArtifact,
  resolveConfigPaths,
  resolveArtifactPath,
  resolveDevSession,
  saveUiSettings,
  solidityDeclarations,
  writeStateKeyBook,
  type DevSession,
  type ResolvedDevSession,
  type ResolvedTarget,
  type StateKeyBook,
} from "@consol/core";
import { runCastCall, runCastCalldata, runCastEstimate, runForgeBuild } from "@consol/foundry";
import {
  createRpcAdapter as createDefaultRpcAdapter,
  type CreateRpcAdapterInput,
  type RpcAdapter,
  type RpcNetworkKind,
} from "@consol/rpc";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  runDevShell,
  type BuildRequestResult,
  type DevAccountStatusEntry,
  type ConfirmedTxPreviewResult,
  type DevAccountStatusSnapshot,
  type DevContractEventRecord,
  type DevDeployedContract,
  type DevRuntimeSelection,
  type DevSettingsChange,
  type DevSettingsSnapshot,
  type DevStateKeyBookChange,
  type DevStateKeyBookDetailEntry,
  type DevStateRowDetailRequest,
  type DevStateRowDetailSnapshot,
  type DevStateSnapshot,
  type DevStateSnapshotRequest,
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
import { createEntryLaunchInput, createSourceFileSelectHandler } from "./dev-entry";
import { createDevJsonSnapshot } from "./dev-json";
import { devAccountOptions, devNetworkOptions } from "./dev-options";
import { devSessionActionContext } from "./dev-session-context";
import { sourcePreviewsForSession } from "./dev-source-preview";
import { parseBuildDiagnostics } from "./diagnostics";
import { deploymentEntries, type DeployListItem } from "./deploy-cache";
import { runDeployCommand } from "./deploy";
import { createReadContext } from "./interact-context";
import { runSendCommand } from "./send";
import { foundryResultMessage, runForgeInspectStorageLayoutWithCacheRecovery } from "./storage-layout-inspect";
import { createComplexStorageSnapshot, type ComplexStorageEntry, type ComplexStorageRow } from "./storage-state";

export type LaunchTui = (input: RunDevShellInput) => Promise<void>;
export type CreateDevRpcAdapter = (input: CreateRpcAdapterInput & { readonly network: NetworkMeta }) => RpcAdapter;

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

  const deployedContracts = createDevDeployedContractsSnapshot(input, session);

  await (input.launchTui ?? runDevShell)({
    session,
    locale: input.locale,
    networkOptions: devNetworkOptions(input),
    accountOptions: devAccountOptions(input),
    sourcePreviews: sourcePreviewsForSession(session),
    accountStatus: await createDevAccountStatusSnapshot(input, initialRuntimeSelection(input)),
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
      saveDevStateKeyBookChange(context?.session?.projectRoot ?? session.projectRoot, change);
    },
    onTransactionsRequest: async (nextSession) => {
      return await createDevTransactionsSnapshot(input, nextSession);
    },
    onDeployedContractsRequest: (nextSession) => {
      return createDevDeployedContractsSnapshot(input, nextSession);
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
      saveDevStateKeyBookChange(context?.session?.projectRoot ?? input.globals.project ?? input.cwd, change);
    },
    onTransactionsRequest: async (session) => {
      return await createDevTransactionsSnapshot(input, session);
    },
    onDeployedContractsRequest: (session) => {
      return createDevDeployedContractsSnapshot(input, session);
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

async function executeDevBuild(input: RunDevCommandInput, session: DevSession): Promise<BuildRequestResult> {
  const build = await runForgeBuild({
    cwd: session.projectRoot,
    projectRoot: session.projectRoot,
    env: input.env,
  });
  const diagnostics = parseBuildDiagnostics(build.stdout, build.stderr);
  if (build.ok) {
    return {
      status: "ok",
      message: `Build ok: ${session.contract}`,
      diagnostics,
      stdout: build.stdout,
      stderr: build.stderr,
    };
  }

  return {
    status: "error",
    message: build.stderr.trim() || build.stdout.trim() || build.error,
    diagnostics,
    stdout: build.stdout,
    stderr: build.stderr,
  };
}

async function createDevStateSnapshot(input: RunDevCommandInput, request: DevStateSnapshotRequest): Promise<DevStateSnapshot> {
  const session = request.session;
  const deployedContract = request.deployedContract ?? null;
  if (deployedContract === null) {
    return {
      status: {
        status: "deployed_contract_not_selected",
        message: "No deployed contract selected.",
        hint: null,
      },
      address: null,
      values: [],
    };
  }

  try {
    const snapshot = await createDevJsonSnapshot({
      globals: input.globals,
      cwd: deployedContract.workspaceRoot ?? session.projectRoot,
      env: input.env,
      session,
      targetOverride: deployedContract.target,
      addressOverride: deployedContract.address,
      ensureArtifact: async (resolved) => {
        await ensureDevArtifact(input, { target: deployedContract.target, resolved });
      },
    });
    return devStateSnapshotFromUnknown({
      state: snapshot.data["state"],
      deployment: snapshot.data["deployment"],
      network: snapshot.data["network"],
      account: snapshot.data["account"],
      session,
    });
  } catch (error) {
    return {
      status: {
        status: "state_failed",
        message: errorMessage(error),
        hint: null,
      },
      address: null,
      values: [],
    };
  }
}

async function createDevStateRowDetailSnapshot(
  input: RunDevCommandInput,
  request: DevStateRowDetailRequest,
): Promise<DevStateRowDetailSnapshot> {
  const context = await createReadContext({
    globals: input.globals,
    cwd: request.deployedContract.workspaceRoot ?? request.session.projectRoot,
    env: input.env,
    target: request.deployedContract.target,
    addressOverride: request.deployedContract.address,
    ensureArtifact: async (resolved) => {
      await ensureDevArtifact(input, { target: request.deployedContract.target, resolved });
    },
  });
  const contractId = detailContractIdentifier(context.artifact.raw, context.artifact.path, context.resolved.contractName);
  const layout = await runForgeInspectStorageLayoutWithCacheRecovery({
    cwd: context.resolved.projectRoot,
    projectRoot: context.resolved.projectRoot,
    contractId,
    env: input.env,
  });
  if (!layout.ok) {
    throw new ProjectError({
      code: "storage_layout_failed",
      message: "forge inspect storage-layout failed.",
      hint: foundryResultMessage(layout) || "Run `forge build` and try again.",
    });
  }

  const snapshot = await createComplexStorageSnapshot({
    layoutJson: layout.stdout,
    projectRoot: context.resolved.projectRoot,
    target: detailStateTarget(context.resolved),
    contract: context.resolved.contractName,
    address: context.address,
    rpc: rpcAdapterForRuntime(input, { meta: context.network, rpcUrl: context.rpc_url }),
    keyBook: readStateKeyBook(context.resolved.projectRoot),
    previewLimit: 3,
    mode: "detail",
    rowId: request.rowId,
    showDefaults: request.showDefaults,
  });
  const row = snapshot.rows.find((item) => item.id === request.rowId) ?? snapshot.rows[0];
  if (row === undefined) {
    return {
      rowId: request.rowId,
      title: "State details",
      lines: ["No storage detail is available."],
      copyValue: null,
    };
  }

  const detail = complexStorageDetail(row);
  return {
    rowId: request.rowId,
    title: `State details: ${row.name}`,
    lines: detail.lines,
    copyValue: detail.lines.join("\n"),
    ...(detail.keyBookEntries.length === 0 ? {} : { keyBookEntries: detail.keyBookEntries }),
  };
}

function saveDevStateKeyBookChange(projectRoot: string, change: DevStateKeyBookChange): void {
  const book = readStateKeyBook(projectRoot);
  const next =
    change.action === "add_key"
      ? addStateKey(book, {
        layoutId: change.layoutId,
        target: change.target,
        contract: change.contract,
        key: change.key,
      })
      : change.action === "delete_key"
        ? deleteStateKey(book, {
          layoutId: change.layoutId,
          type: change.type,
          value: change.value,
        })
        : setStateKeyEnabled(book, change);
  writeStateKeyBook(projectRoot, next);
}

function setStateKeyEnabled(
  book: StateKeyBook,
  change: Extract<DevStateKeyBookChange, { readonly action: "set_key_enabled" }>,
): StateKeyBook {
  const contract = book.contracts[change.layoutId];
  const key = contract?.keys.find((item) => item.type === change.type && item.value === change.value);
  if (contract === undefined || key === undefined) {
    return book;
  }

  return addStateKey(book, {
    layoutId: change.layoutId,
    target: contract.target,
    contract: contract.contract,
    key: { ...key, enabled: change.enabled },
  });
}

function complexStorageDetail(row: ComplexStorageRow): {
  readonly lines: readonly string[];
  readonly keyBookEntries: readonly DevStateKeyBookDetailEntry[];
} {
  const lines: string[] = [
    `${row.name}  ${row.type_label}`,
    `summary: ${row.summary}`,
    ...(row.checked === undefined ? [] : [`checked: ${row.checked}`]),
    ...(row.non_default === undefined ? [] : [`non-default: ${row.non_default}`]),
    ...(row.default_values_hidden === true ? ["default values hidden"] : []),
    ...(row.error === undefined || row.error === null ? [] : [`error: ${row.error}`]),
  ];
  const keyBookEntries: DevStateKeyBookDetailEntry[] = [];
  const visibleLineByKey = new Map<string, number>();

  if (row.entries !== undefined && row.entries.length > 0) {
    lines.push("");
    for (const entry of row.entries) {
      const lineIndex = lines.length;
      lines.push(complexStorageEntryLine(entry));
      const keyValue = entry.key[0];
      if (row.kind === "mapping" && entry.key_type !== undefined && keyValue !== undefined) {
        visibleLineByKey.set(stateKeyBookEntryId(entry.key_type, keyValue), lineIndex);
      }
    }
  }

  for (const entry of row.key_book_entries ?? row.entries ?? []) {
    const keyValue = entry.key[0];
    if (row.kind === "mapping" && entry.key_type !== undefined && keyValue !== undefined) {
      keyBookEntries.push({
        type: entry.key_type,
        value: keyValue,
        label: entry.label,
        lineIndex: visibleLineByKey.get(stateKeyBookEntryId(entry.key_type, keyValue)) ?? -1,
      });
    }
  }

  return { lines, keyBookEntries };
}

function stateKeyBookEntryId(type: string, value: string): string {
  return `${type}\u0000${value}`;
}

function complexStorageEntryLine(entry: ComplexStorageEntry): string {
  const label = entry.label ?? (entry.key.length === 0 ? "value" : entry.key.join(","));
  return `${label}: ${entry.readable}${entry.default ? " (default)" : ""}  raw=${entry.raw}`;
}

function detailStateTarget(resolved: ResolvedTarget): string {
  return resolved.sourceFile === undefined ? resolved.contractName : `${resolved.sourceFile}:${resolved.contractName}`;
}

function detailContractIdentifier(rawArtifact: unknown, artifactPath: string, contractName: string): string {
  const source = detailArtifactSource(rawArtifact);
  if (source !== undefined) {
    return `${source}:${contractName}`;
  }

  return `src/${basename(dirname(artifactPath))}:${contractName}`;
}

function detailArtifactSource(rawArtifact: unknown): string | undefined {
  const metadata = recordFromUnknown(rawArtifact)?.["metadata"];
  const settings = recordFromUnknown(metadata)?.["settings"];
  const compilationTarget = recordFromUnknown(recordFromUnknown(settings)?.["compilationTarget"]);
  return compilationTarget === undefined ? undefined : Object.keys(compilationTarget)[0];
}

async function createDevTransactionsSnapshot(input: RunDevCommandInput, session: DevSession): Promise<readonly DevTransactionRecord[]> {
  try {
    const snapshot = await createDevJsonSnapshot({
      globals: input.globals,
      cwd: session.projectRoot,
      env: input.env,
      session,
    });
    return arrayFromUnknown(snapshot.data["transactions"]).map(devTransactionRecordFromUnknown);
  } catch {
    return [];
  }
}

function createDevDeployedContractsSnapshot(input: RunDevCommandInput, session: DevSession): readonly DevDeployedContract[] {
  const entries = deploymentEntries(session.projectRoot);
  return entries.flatMap((entry) => {
    const contractSession = devSessionForDeployment(input, session, entry);
    if (contractSession === null) {
      return [];
    }
    return [deployedContractFromCacheEntry(contractSession, entry)];
  });
}

function devSessionForDeployment(
  input: RunDevCommandInput,
  session: DevSession,
  entry: DeployListItem,
): DevSession | null {
  if (entry.contract === session.contract) {
    return session;
  }

  try {
    const nextSession = createDevSessionFromResolved(resolveDevSession({
      cwd: session.projectRoot,
      target: entry.contract,
      ...(input.globals.project === undefined ? { projectRoot: session.projectRoot } : { projectRoot: input.globals.project }),
    }));
    return session.workspaceRoot === undefined ? nextSession : { ...nextSession, workspaceRoot: session.workspaceRoot };
  } catch {
    return null;
  }
}

function deployedContractFromCacheEntry(session: DevSession, entry: DeployListItem): DevDeployedContract {
  return {
    id: `${entry.network}:${entry.chain_id ?? "-"}:${entry.contract}:${entry.address.toLowerCase()}:${entry.deploy_tx ?? entry.deployed_at_unix}`,
    contract: entry.contract,
    address: entry.address,
    target: session.target,
    ...(session.workspaceRoot === undefined ? {} : { workspaceRoot: session.workspaceRoot }),
    sourceFile: session.sourceFile,
    network: entry.network,
    chainId: entry.chain_id === null ? null : String(entry.chain_id),
    account: entry.deployer,
    deployTxHash: entry.deploy_tx,
    status: "ready",
    constructorArgs: [],
    value: entry.deployment_value,
    abiSummary: session.abiSummary,
    constructor: session.constructor,
    functions: session.functions,
    createdAtUnix: entry.deployed_at_unix,
  };
}

async function createDevEventRecordsSnapshot(input: RunDevCommandInput, session: DevSession): Promise<readonly DevContractEventRecord[]> {
  try {
    const snapshot = await createDevJsonSnapshot({
      globals: input.globals,
      cwd: session.projectRoot,
      env: input.env,
      session,
    });
    const logs = recordFromUnknown(snapshot.data["events"]);
    return arrayFromUnknown(logs?.["events"]).map((event, index) => devContractEventRecordFromUnknown(event, session, index));
  } catch {
    return [];
  }
}

function devContractEventRecordFromUnknown(raw: unknown, session: DevSession, index: number): DevContractEventRecord {
  const record = recordFromUnknown(raw);
  const txHash = nullableStringFromUnknown(record?.["transaction_hash"]);
  const blockNumber = nullableScalarStringFromUnknown(record?.["block_number"]);
  const logIndex = nullableScalarStringFromUnknown(record?.["log_index"]);
  return {
    id: `${txHash ?? "event"}:${logIndex ?? index}`,
    source: "logs",
    contract: session.contract,
    address: nullableStringFromUnknown(record?.["address"]),
    event: nullableStringFromUnknown(record?.["event"]),
    signature: nullableStringFromUnknown(record?.["signature"]),
    args: arrayFromUnknown(record?.["args"]).map(devContractEventArgFromUnknown),
    raw: rawEventString(record?.["raw"]),
    txHash,
    blockNumber,
    logIndex,
    createdAtUnix: Math.floor(Date.now() / 1000) - index,
  };
}

function devContractEventArgFromUnknown(raw: unknown): DevContractEventRecord["args"][number] {
  const record = recordFromUnknown(raw);
  return {
    name: stringFromUnknown(record?.["name"]) ?? "",
    kind: stringFromUnknown(record?.["kind"]) ?? "",
    indexed: record?.["indexed"] === true,
    value: nullableScalarStringFromUnknown(record?.["value"]) ?? "",
  };
}

function rawEventString(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
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

function createDevBlockWatchHandler(input: RunDevCommandInput): NonNullable<RunDevShellInput["onBlockWatchStart"]> {
  return ({ session, selection }, onBlockNumber) => {
    const runtime = networkRuntimeForSelection(input, selection.networkName);
    const adapter = rpcAdapterForRuntime(input, runtime);
    const stops: Array<() => void> = [];
    stops.push(adapter.watchBlockNumber((blockNumber) => {
      onBlockNumber(String(blockNumber));
    }));

    for (const contract of createDevDeployedContractsSnapshot(input, session).filter((contract) => sameRuntimeNetwork(contract, runtime.meta))) {
      const abi = deployedContractAbi(input, session, contract);
      if (abi === null) {
        continue;
      }
      stops.push(adapter.watchContractEvent({
        address: contract.address,
        abi,
        onLogs: () => {
          onBlockNumber("events");
        },
      }));
    }

    return () => {
      for (const stop of stops.splice(0).reverse()) {
        stop();
      }
    };
  };
}

function sameRuntimeNetwork(contract: DevDeployedContract, network: NetworkMeta): boolean {
  return contract.network === network.name
    || contract.network === network.fingerprint
    || (contract.chainId !== null && network.chain_id !== null && contract.chainId === String(network.chain_id));
}

function deployedContractAbi(
  input: RunDevCommandInput,
  session: DevSession,
  contract: DevDeployedContract,
): readonly unknown[] | null {
  const contractSession = contract.contract === session.contract
    ? session
    : devSessionForDeployment(input, session, {
        contract: contract.contract,
        address: contract.address,
        chain_id: contract.chainId === null ? null : Number(contract.chainId),
        network: contract.network ?? "",
        deployer: contract.account,
        bytecode_hash: "",
        constructor_args_hash: "",
        deployment_value: contract.value ?? null,
        deploy_tx: contract.deployTxHash ?? null,
        deployed_at_unix: contract.createdAtUnix,
      });
  if (contractSession === null) {
    return null;
  }

  try {
    return readContractArtifact(contractSession.artifactPath).abi;
  } catch {
    return null;
  }
}

function networkRuntimeForSelection(
  input: RunDevCommandInput,
  networkName: string,
): { readonly meta: NetworkMeta; readonly rpcUrl: string } {
  const profile = networkProfiles(input.env)[networkName];
  if (profile === undefined) {
    throw new ProjectError({
      code: "network_not_found",
      message: `Network profile \`${networkName}\` does not exist.`,
      hint: "Run `consol network list` or select another network.",
    });
  }

  const rpcUrl = profile.rpc_url ?? envValue(input.env, profile.rpc_url_env);
  if (rpcUrl === undefined) {
    throw new ProjectError({
      code: "network_rpc_missing",
      message: `Network profile \`${networkName}\` requires an RPC URL.`,
      hint: "Set the configured RPC environment variable or update the network profile.",
    });
  }

  return {
    meta: networkMetaFromProfile(networkName, profile, input.env) ?? activeNetworkRuntime(input.env).meta,
    rpcUrl,
  };
}

function rpcAdapterForRuntime(
  input: RunDevCommandInput,
  runtime: { readonly meta: NetworkMeta; readonly rpcUrl: string },
): RpcAdapter {
  const factory = input.createRpcAdapter ?? ((adapterInput: CreateRpcAdapterInput & { readonly network: NetworkMeta }) => createDefaultRpcAdapter(adapterInput));
  return factory({
    rpcUrl: runtime.rpcUrl,
    networkKind: rpcNetworkKind(runtime.meta),
    network: runtime.meta,
  });
}

function rpcAdapterForNetwork(input: RunDevCommandInput, network: NetworkMeta): RpcAdapter {
  return rpcAdapterForRuntime(input, { meta: network, rpcUrl: network.rpc_url });
}

function rpcNetworkKind(network: NetworkMeta): RpcNetworkKind {
  return network.kind === "anvil" || network.kind === "local" ? "local" : "remote";
}

function envValue(env: CliEnv, name: string | undefined): string | undefined {
  if (name === undefined) {
    return undefined;
  }

  const value = env[name]?.trim();
  return value === "" ? undefined : value;
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

function devStateSnapshotFromUnknown(input: {
  readonly state: unknown;
  readonly deployment: unknown;
  readonly network: unknown;
  readonly account: unknown;
  readonly session: DevSession;
}): DevStateSnapshot {
  const record = recordFromUnknown(input.state);
  const status = recordFromUnknown(record?.["status"]);
  const deployment = recordFromUnknown(input.deployment);
  const deploymentEntry = recordFromUnknown(deployment?.["entry"]);
  const deploymentAddress = nullableStringFromUnknown(deployment?.["address"]);
  const storageValues = arrayFromUnknown(record?.["storage_values"]).map(storageStateRowSnapshotFromUnknown);
  const storageHints = arrayFromUnknown(record?.["storage_hints"]).flatMap((item) => {
    const value = stringFromUnknown(item);
    return value === undefined ? [] : [value];
  });
  const storageLayoutId = nullableStringFromUnknown(record?.["storage_layout_id"]);
  return {
    status: {
      status: stringFromUnknown(status?.["status"]) ?? "activity_unavailable",
      message: nullableStringFromUnknown(status?.["message"]) ?? `Activity snapshot is unavailable for ${input.session.contract}.`,
      hint: nullableStringFromUnknown(status?.["hint"]),
    },
    address: nullableStringFromUnknown(record?.["address"]) ?? deploymentAddress,
    details: stateDetailSnapshots({
      session: input.session,
      deployment: deploymentEntry,
      network: input.network,
      account: input.account,
    }),
    values: arrayFromUnknown(record?.["values"]).map(stateValueSnapshotFromUnknown),
    ...(storageValues.length === 0 ? {} : { storageValues }),
    ...(storageHints.length === 0 ? {} : { storageHints }),
    ...(storageLayoutId === null ? {} : { storageLayoutId }),
  };
}

function stateDetailSnapshots(input: {
  readonly session: DevSession;
  readonly deployment: Record<string, unknown> | undefined;
  readonly network: unknown;
  readonly account: unknown;
}): NonNullable<DevStateSnapshot["details"]> {
  void input.session;
  void input.network;
  void input.account;
  return [
    stateDetail("tui.state.detail.deployer", nullableStringFromUnknown(input.deployment?.["deployer"])),
    stateDetail("tui.state.detail.deployTx", nullableStringFromUnknown(input.deployment?.["deploy_tx"])),
    stateDetail("tui.state.detail.deployedAt", nullableScalarStringFromUnknown(input.deployment?.["deployed_at_unix"])),
  ].flatMap((detail) => detail);
}

function stateDetail(
  labelKey: NonNullable<DevStateSnapshot["details"]>[number]["labelKey"],
  value: string | null | undefined,
): readonly NonNullable<DevStateSnapshot["details"]>[number][] {
  return value === null || value === undefined || value.length === 0 ? [] : [{ labelKey, value }];
}

function stateValueSnapshotFromUnknown(raw: unknown): DevStateSnapshot["values"][number] {
  const record = recordFromUnknown(raw);
  return {
    name: stringFromUnknown(record?.["name"]) ?? "",
    signature: stringFromUnknown(record?.["signature"]) ?? "",
    output_types: arrayFromUnknown(record?.["output_types"]).flatMap((item) => {
      const value = stringFromUnknown(item);
      return value === undefined ? [] : [value];
    }),
    readable: nullableStringFromUnknown(record?.["readable"]),
    raw: stringFromUnknown(record?.["raw"]) ?? "",
    error: nullableStringFromUnknown(record?.["error"]),
  };
}

function storageStateRowSnapshotFromUnknown(raw: unknown): NonNullable<DevStateSnapshot["storageValues"]>[number] {
  const record = recordFromUnknown(raw);
  const kind = storageRowKindFromUnknown(record?.["kind"]);
  const checked = numberFromUnknown(record?.["checked"]);
  const nonDefault = numberFromUnknown(record?.["non_default"]);
  const defaultValuesHidden = booleanFromUnknown(record?.["default_values_hidden"]);
  return {
    id: stringFromUnknown(record?.["id"]) ?? "",
    kind,
    name: stringFromUnknown(record?.["name"]) ?? "",
    typeLabel: stringFromUnknown(record?.["type_label"]) ?? "",
    summary: stringFromUnknown(record?.["summary"]) ?? "",
    detailAvailable: booleanFromUnknown(record?.["detail_available"]) ?? false,
    ...(checked === undefined ? {} : { checked }),
    ...(nonDefault === undefined ? {} : { nonDefault }),
    ...(defaultValuesHidden === undefined ? {} : { defaultValuesHidden }),
    error: nullableStringFromUnknown(record?.["error"]),
  };
}

function storageRowKindFromUnknown(raw: unknown): NonNullable<DevStateSnapshot["storageValues"]>[number]["kind"] {
  const value = stringFromUnknown(raw);
  switch (value) {
    case "scalar":
    case "array":
    case "struct":
    case "mapping":
    case "error":
      return value;
    default:
      return "error";
  }
}

function devTransactionRecordFromUnknown(raw: unknown): DevTransactionRecord {
  const record = recordFromUnknown(raw);
  const receipt = recordFromUnknown(record?.["receipt"]);
  const transaction = recordFromUnknown(record?.["transaction"]);
  const block = recordFromUnknown(record?.["block"]);
  const id = stringFromUnknown(record?.["id"]) ?? `${numberFromUnknown(record?.["created_at_unix"]) ?? 0}:${stringFromUnknown(record?.["action"]) ?? "tx"}`;
  const rawOutput = devTransactionRawOutput(record);
  return {
    id,
    action: stringFromUnknown(record?.["action"]) ?? "tx",
    contract: stringFromUnknown(record?.["contract"]) ?? "",
    target: nullableStringFromUnknown(record?.["target"]),
    functionName: nullableStringFromUnknown(record?.["function"]),
    signature: nullableStringFromUnknown(record?.["signature"]),
    args: arrayFromUnknown(record?.["args"]).flatMap((item) => {
      const value = stringFromUnknown(item);
      return value === undefined ? [] : [value];
    }),
    result: nullableStringFromUnknown(record?.["result"]),
    rawOutput,
    txHash: nullableStringFromUnknown(record?.["tx_hash"]),
    blockNumber: nullableScalarStringFromUnknown(receipt?.["block_number"] ?? receipt?.["blockNumber"]),
    confirmations: nullableScalarStringFromUnknown(record?.["confirmations"] ?? receipt?.["confirmations"]),
    status: nullableScalarStringFromUnknown(receipt?.["status"]),
    gasUsed: nullableScalarStringFromUnknown(receipt?.["gas_used"] ?? receipt?.["gasUsed"]),
    gasLimit: nullableScalarStringFromUnknown(record?.["gas_limit"] ?? record?.["gasLimit"] ?? transaction?.["gas"] ?? transaction?.["gasLimit"]),
    network: nullableStringFromUnknown(record?.["network"]),
    chainId: nullableScalarStringFromUnknown(record?.["chain_id"]),
    networkFingerprint: nullableStringFromUnknown(record?.["network_fingerprint"]),
    account: nullableStringFromUnknown(record?.["account"]),
    address: nullableStringFromUnknown(record?.["address"]),
    from: nullableStringFromUnknown(record?.["from"]),
    to: nullableStringFromUnknown(record?.["to"]),
    signerAddress: nullableStringFromUnknown(record?.["signer_address"]),
    nonce: nullableScalarStringFromUnknown(record?.["nonce"]),
    gasPrice: nullableScalarStringFromUnknown(record?.["gas_price"] ?? record?.["gasPrice"] ?? transaction?.["gasPrice"]),
    maxFeePerGas: nullableScalarStringFromUnknown(record?.["max_fee_per_gas"] ?? record?.["maxFeePerGas"] ?? transaction?.["maxFeePerGas"]),
    maxPriorityFeePerGas: nullableScalarStringFromUnknown(
      record?.["max_priority_fee_per_gas"] ?? record?.["maxPriorityFeePerGas"] ?? transaction?.["maxPriorityFeePerGas"],
    ),
    effectiveGasPrice: nullableScalarStringFromUnknown(receipt?.["effective_gas_price"] ?? receipt?.["effectiveGasPrice"]),
    contractAddress: nullableStringFromUnknown(receipt?.["contract_address"] ?? receipt?.["contractAddress"]),
    gasEstimate: nullableScalarStringFromUnknown(record?.["gas_estimate"]),
    gasEstimateError: nullableScalarStringFromUnknown(record?.["gas_estimate_error"]),
    calldataHash: nullableStringFromUnknown(record?.["calldata_hash"]),
    calldataPrefix: nullableStringFromUnknown(record?.["calldata_prefix"]),
    input: nullableStringFromUnknown(record?.["input"] ?? record?.["calldata"] ?? transaction?.["input"]),
    logs: logLinesFromUnknown(record?.["logs"] ?? receipt?.["logs"]),
    events: arrayFromUnknown(record?.["events"]).map((event, index) => devContractEventRecordFromUnknown(event, { contract: stringFromUnknown(record?.["contract"]) ?? "" } as DevSession, index)),
    value: nullableScalarStringFromUnknown(record?.["value"]),
    blockTimestamp: nullableScalarStringFromUnknown(record?.["block_timestamp"] ?? record?.["timestamp"] ?? block?.["timestamp"]),
    createdAtUnix: numberFromUnknown(record?.["created_at_unix"]) ?? 0,
  };
}

function devTransactionRawOutput(record: Record<string, unknown> | undefined): string | null {
  const explicit = nullableStringFromUnknown(record?.["raw_output"] ?? record?.["rawOutput"] ?? record?.["tx_output"]);
  if (explicit !== null) {
    return explicit;
  }
  return record === undefined ? null : JSON.stringify(record, null, 2);
}

function recordFromUnknown(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}

function arrayFromUnknown(raw: unknown): readonly unknown[] {
  return Array.isArray(raw) ? raw : [];
}

function stringFromUnknown(raw: unknown): string | undefined {
  return typeof raw === "string" ? raw : undefined;
}

function booleanFromUnknown(raw: unknown): boolean | undefined {
  return typeof raw === "boolean" ? raw : undefined;
}

function nullableStringFromUnknown(raw: unknown): string | null {
  return raw === null ? null : stringFromUnknown(raw) ?? null;
}

function nullableScalarStringFromUnknown(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  switch (typeof raw) {
    case "string":
      return raw;
    case "number":
    case "bigint":
    case "boolean":
      return String(raw);
    default:
      return null;
  }
}

function numberFromUnknown(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function logLinesFromUnknown(raw: unknown): readonly string[] {
  return arrayFromUnknown(raw).flatMap((item) => {
    if (typeof item === "string") {
      return [item];
    }

    if (typeof item === "object" && item !== null) {
      const record = item as Record<string, unknown>;
      const event = stringFromUnknown(record["event"]) ?? stringFromUnknown(record["name"]);
      const address = stringFromUnknown(record["address"]);
      const transactionHash = stringFromUnknown(record["transactionHash"]) ?? stringFromUnknown(record["transaction_hash"]);
      return [[event, address, transactionHash].filter((value) => value !== undefined && value.length > 0).join(" ")].filter((value) => value.length > 0);
    }

    return [];
  });
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const hint = errorHint(error);
  return hint === undefined || hint.length === 0 ? error.message : `${error.message}\n${hint}`;
}

function errorHint(error: Error): string | undefined {
  const hint = (error as { readonly hint?: unknown }).hint;
  return typeof hint === "string" ? hint.trim() : undefined;
}

async function ensureDevArtifact(input: RunDevCommandInput, prepared: ResolvedDevSession): Promise<void> {
  if (artifactExists(prepared)) {
    return;
  }

  const build = await runForgeBuild({
    cwd: prepared.resolved.projectRoot,
    projectRoot: prepared.resolved.projectRoot,
    env: input.env,
  });
  if (!build.ok) {
    throw new ProjectError({
      code: "dev_build_failed",
      message: "Foundry build failed before launching dev.",
      hint: build.stderr.trim() || build.stdout.trim() || "Run `consol build` to inspect diagnostics.",
    });
  }
}

function artifactExists(prepared: ResolvedDevSession): boolean {
  try {
    return existsSync(resolveArtifactPath(prepared.resolved));
  } catch (error) {
    if (error instanceof ProjectError && error.code === "artifact_not_found") {
      return false;
    }
    throw error;
  }
}

function commandTarget(commandArgs: readonly string[]): string | undefined {
  const index = commandTargetIndex(commandArgs);
  return index < 0 ? undefined : commandArgs[index];
}

function commandTargetIndex(commandArgs: readonly string[]): number {
  return commandArgs.findIndex((arg) => arg !== "--json");
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

function findDevDirectory(cwd: string, target: string): string | null {
  const path = isAbsolute(target) ? target : resolve(cwd, target);
  try {
    return statSync(path).isDirectory() ? realpathSync(path) : null;
  } catch {
    return null;
  }
}

function preferredDevTarget(input: RunDevCommandInput, target: string): string {
  if (!target.includes(".sol")) {
    return target;
  }

  const { file, explicitContract } = splitDevSourceTarget(target);
  if (explicitContract !== undefined && explicitContract !== "") {
    return target;
  }

  const sourceFile = findDevSourceFile(input, file);
  if (sourceFile === null) {
    return target;
  }

  const declarations = solidityDeclarations(readFileSync(sourceFile, "utf8"));
  if (declarations.length <= 1) {
    return target;
  }

  const preferred = declarations.find((declaration) => declaration.deployable)?.name ?? declarations[0]?.name;
  return preferred === undefined ? target : `${file}:${preferred}`;
}

function splitDevSourceTarget(target: string): { readonly file: string; readonly explicitContract?: string } {
  const separator = target.indexOf(":");
  if (separator === -1) {
    return { file: target };
  }

  return {
    file: target.slice(0, separator),
    explicitContract: target.slice(separator + 1),
  };
}

function findDevSourceFile(input: RunDevCommandInput, file: string): string | null {
  for (const candidate of devSourceFileCandidates(input, file)) {
    if (existsSync(candidate)) {
      return realpathSync(candidate);
    }
  }
  return null;
}

function devSourceFileCandidates(input: RunDevCommandInput, file: string): readonly string[] {
  if (isAbsolute(file)) {
    return [file];
  }

  const candidates: string[] = [];
  if (input.globals.project !== undefined) {
    candidates.push(join(input.globals.project, file));
  }
  candidates.push(resolve(input.cwd, file));
  candidates.push(file);
  return candidates;
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

function eventCreatedAtUnix(timestamp: string): number {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? Math.floor(Date.now() / 1000) : Math.floor(date.getTime() / 1000);
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
    const actionGlobals = actionGlobalsForSubmission(input.globals, submission);
    const event = createDeployInputPreview(input, submission);
    previewActionContexts.set(event.id, {
      ...devSessionActionContext(submission.session),
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
        ...(gas.ok ? {} : { error: gas.stderr.trim() || gas.stdout.trim() || gas.error }),
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
  const event = createDeployInputPreview(input, {
    action: "deploy",
    session: submission.session,
    function: deploymentFunction(submission.session),
    args: [],
    value: null,
    ...(submission.gasLimit == null ? {} : { gasLimit: submission.gasLimit }),
    ...(submission.accountName === undefined ? {} : { accountName: submission.accountName }),
    ...(submission.networkName === undefined ? {} : { networkName: submission.networkName }),
    ...(submission.cwdOverride === undefined ? {} : { cwdOverride: submission.cwdOverride }),
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

function sessionActionGlobals(globals: GlobalArgs): GlobalArgs {
  const { project: _project, ...rest } = globals;
  return rest;
}

function actionGlobalsForSubmission(globals: GlobalArgs, submission: FunctionInputSubmission): GlobalArgs {
  const base = sessionActionGlobals(globals);
  if (submission.accountName === undefined && submission.networkName === undefined) {
    return base;
  }

  const { signer: _signer, ...withoutSigner } = base;
  return {
    ...withoutSigner,
    ...(submission.accountName === undefined ? {} : { account: submission.accountName }),
    ...(submission.networkName === undefined ? {} : { network: submission.networkName }),
  };
}

function createDeployInputPreview(input: RunDevCommandInput, submission: FunctionInputSubmission): TxPreviewEvent {
  const network = activeNetworkRuntime(input.env).meta;
  const account = accountMetaForSubmission(input, submission);
  return {
    type: "tx.preview",
    id: `deploy-preview-${Date.now()}`,
    timestamp: new Date().toISOString(),
    action: "deploy",
    network: txPreviewNetwork(network),
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
    gas: {
      source: "compiler_estimate",
      confidence: "low",
      context: {
        ...(submission.action === "redeploy" ? { fresh: true } : {}),
        ...(submission.gasLimit == null ? {} : { gasLimit: submission.gasLimit }),
      },
    },
  };
}

function gasLimitArgs(event: TxPreviewEvent): readonly string[] {
  const gasLimit = event.gas.context?.["gasLimit"];
  return gasLimit === undefined || gasLimit === null || String(gasLimit).trim().length === 0
    ? []
    : ["--gas-limit", String(gasLimit)];
}

function accountMetaForSubmission(input: RunDevCommandInput, submission: FunctionInputSubmission): AccountMeta {
  const selector = submission.accountName ?? input.globals.account ?? input.globals.signer;
  return selector === undefined ? activeAccountMeta(input.env) : accountMetaFromSelector(loadConsolConfig(input.env), selector);
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
