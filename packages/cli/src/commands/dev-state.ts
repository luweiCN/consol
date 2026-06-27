import {
  activeNetworkRuntime,
  addStateKey,
  deleteStateKey,
  ProjectError,
  readStateKeyBook,
  writeStateKeyBook,
  type DevSession,
  type ResolvedTarget,
  type StateKeyBook,
} from "@consol/core";
import type {
  DevStateKeyBookChange,
  DevStateKeyBookDetailEntry,
  DevStateRowDetailRequest,
  DevStateRowDetailSnapshot,
  DevStateSnapshot,
  DevStateSnapshotRequest,
} from "@consol/tui";
import type { GlobalArgs } from "../args";
import type { CliEnv } from "../main";
import { createDevJsonSnapshot } from "./dev-json";
import { createReadContext } from "./interact-context";
import { foundryResultMessage, runForgeInspectStorageLayoutWithCacheRecovery } from "./storage-layout-inspect";
import { createComplexStorageSnapshot, type ComplexStorageEntry, type ComplexStorageRow } from "./storage-state";
import { detailContractIdentifier, ensureDevArtifact } from "./dev-artifact";
import { networkRuntimeForSelection, rpcAdapterForRuntime, type CreateDevRpcAdapter } from "./dev-runtime";
import {
  arrayFromUnknown,
  booleanFromUnknown,
  errorMessage,
  nullableScalarStringFromUnknown,
  nullableStringFromUnknown,
  numberFromUnknown,
  recordFromUnknown,
  stringFromUnknown,
} from "./dev-unknown";

// Narrowed view of the dev command input — only the fields state assembly needs.
// `RunDevCommandInput` structurally satisfies this.
type DevStateInput = {
  readonly globals: GlobalArgs;
  readonly env: CliEnv;
  readonly createRpcAdapter?: CreateDevRpcAdapter;
};

export async function createDevStateSnapshot(input: DevStateInput, request: DevStateSnapshotRequest): Promise<DevStateSnapshot> {
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

export async function createDevStateRowDetailSnapshot(
  input: DevStateInput,
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
    keyBook: readStateKeyBook({ env: input.env, network: context.network }),
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

export function saveDevStateKeyBookChange(
  input: DevStateInput,
  networkName: string | undefined,
  change: DevStateKeyBookChange,
): void {
  const network = networkName === undefined ? activeNetworkRuntime(input.env).meta : networkRuntimeForSelection(input, networkName).meta;
  const book = readStateKeyBook({ env: input.env, network });
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
  writeStateKeyBook({ env: input.env, network, book: next });
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
