import type { DevSourceTarget } from "@consol/core";
import type { Locale } from "@consol/i18n";
import type { DevAccountOption, SelectorKind } from "./DevSelectorLayer";
import { fuzzyFilter } from "./fuzzy";
import type { DevAccountStatusSnapshot, DevDeployedContract } from "./runtime-types";
import type { SelectorOption, SelectorOptionPart } from "./SelectorModal";

export function selectorOpeners(kind: SelectorKind): readonly string[] {
  return kind === "network" ? ["n"] : kind === "account" ? ["a"] : kind === "source" ? ["f"] : kind === "deployed" ? ["c"] : [];
}

export function enrichAccountOptions(
  options: readonly DevAccountOption[],
  status: DevAccountStatusSnapshot | undefined,
): readonly DevAccountOption[] {
  if (status === undefined) {
    return options;
  }

  const statuses = new Map((status.accounts ?? [status]).map((entry) => [entry.accountName, entry]));
  return options.map((option) => {
    const entry = statuses.get(option.name);
    if (entry === undefined) {
      return option;
    }
    const signer = entry.signer ?? signerFromOption(option);
    const address = entry.address ?? addressFromOption(option);
    const balance = (entry.status === "ok" ? entry.balanceDisplay ?? entry.balanceWei : entry.message) ?? "balance unavailable";
    const short = shortAddress(address);
    const signerText = signer ?? "unknown";
    return {
      ...option,
      label: `${option.name} / ${short} / ${signerText}`,
      titleParts: accountTitleParts(option.name, short, signerText),
      detailParts: accountDetailParts(balance),
      ...(address === null ? {} : { copyValue: address }),
      meta: balance,
      searchText: [option.searchText, option.name, address, signer, balance].filter((part): part is string => typeof part === "string" && part.length > 0).join(" "),
    };
  });
}

export function uniqueDeployedContracts(contracts: readonly DevDeployedContract[]): readonly DevDeployedContract[] {
  const records = new Map<string, DevDeployedContract>();
  for (const contract of contracts) {
    const key = deployedContractKey(contract);
    const current = records.get(key);
    if (current === undefined || contract.createdAtUnix >= current.createdAtUnix) {
      records.set(key, contract);
    }
  }
  return [...records.values()].sort((left, right) => right.createdAtUnix - left.createdAtUnix);
}

export function deployedTitleParts(
  contract: DevDeployedContract,
  nowUnix = currentUnix(),
  locale: Locale = "en-US",
): readonly SelectorOptionPart[] {
  return [
    { text: contract.contract, kind: "selected" },
    { text: `  ${deployedContractAgeLabel(contract.createdAtUnix, nowUnix, locale)}`, kind: "muted" },
  ];
}

export function deployedDetailParts(contract: DevDeployedContract): readonly SelectorOptionPart[] {
  return [
    { text: shortAddress(contract.address), kind: "address" },
  ];
}

export function deployedContractAgeLabel(createdAtUnix: number, nowUnix = currentUnix(), locale: Locale = "en-US"): string {
  if (!Number.isFinite(createdAtUnix) || createdAtUnix <= 0 || !Number.isFinite(nowUnix)) {
    return "-";
  }

  const elapsedSeconds = Math.max(0, Math.floor(nowUnix - createdAtUnix));
  if (elapsedSeconds < 60) {
    return locale === "zh-CN" ? `${elapsedSeconds}秒前` : `${elapsedSeconds}s ago`;
  }

  if (elapsedSeconds < 3_600) {
    const minutes = Math.max(1, Math.floor(elapsedSeconds / 60));
    return locale === "zh-CN" ? `${minutes}分钟前` : `${minutes}m ago`;
  }

  if (elapsedSeconds < 86_400) {
    const hours = Math.max(1, Math.floor(elapsedSeconds / 3_600));
    return locale === "zh-CN" ? `${hours}小时前` : `${hours}h ago`;
  }

  return deployedAbsoluteTime(createdAtUnix);
}

export function deployedPreviewLines(contract: DevDeployedContract): readonly string[] {
  return [
    `contract ${contract.contract} {`,
    ...(contract.constructor === null ? [] : [`  ${contract.constructor.signature};`]),
    ...contract.functions.map((item) => `  ${functionPreviewLine(item)}`),
    `}`,
  ];
}

export function deployedPreviewInfoRows(contract: DevDeployedContract): readonly (readonly SelectorOptionPart[])[] {
  return [
    previewInfoRow("address", contract.address, "address"),
    previewInfoRow("network", deployedNetworkLabel(contract), "muted"),
    previewInfoRow("account", contract.account ?? "-", "selected"),
    previewInfoRow("target", contract.target, "code"),
    previewInfoRow("abi", deployedAbiSummary(contract), "muted"),
    ...(contract.deployTxHash === null || contract.deployTxHash === undefined
      ? []
      : [previewInfoRow("tx", contract.deployTxHash, "code")]),
  ];
}

export function sourceTargetIndexForOption(
  sourceTargets: readonly DevSourceTarget[],
  option: SelectorOption,
  query: string,
): number {
  const fallbackIndex = Number(option.name);
  if (query.trim().length === 0) {
    return fallbackIndex;
  }

  const matches = fuzzyFilter(
    sourceTargets.flatMap((target, index) =>
      target.sourceFile === option.label
        ? [{
            name: String(index),
            label: target.target,
            searchText: `${target.sourceFile} ${target.contract}`,
          }]
        : [],
    ),
    query,
  );
  return Number(matches[0]?.name ?? fallbackIndex);
}

export function sourceFileGroups(
  sourceTargets: readonly DevSourceTarget[],
  selectedSourceTargetIndex: number,
): readonly {
  readonly sourceFile: string;
  readonly target: string;
  readonly targetIndex: number;
  readonly contracts: readonly string[];
  readonly active: boolean;
}[] {
  const groups = new Map<string, { target: string; targetIndex: number; contracts: string[]; active: boolean }>();
  sourceTargets.forEach((sourceTarget, index) => {
    const current = groups.get(sourceTarget.sourceFile);
    if (current === undefined) {
      groups.set(sourceTarget.sourceFile, {
        target: sourceTarget.target,
        targetIndex: index,
        contracts: [sourceTarget.contract],
        active: index === selectedSourceTargetIndex,
      });
      return;
    }

    current.contracts.push(sourceTarget.contract);
    if (!current.active && sourceTarget.deployable !== false && sourceTargets[current.targetIndex]?.deployable === false) {
      current.target = sourceTarget.target;
      current.targetIndex = index;
    }
    if (index === selectedSourceTargetIndex) {
      current.target = sourceTarget.target;
      current.targetIndex = index;
      current.active = true;
    }
  });

  return [...groups.entries()].map(([sourceFile, group]) => ({
    sourceFile,
    target: group.target,
    targetIndex: group.targetIndex,
    contracts: group.contracts,
    active: group.active,
  }));
}

function shortAddress(value: string | null): string {
  return value === null ? "no address" : value.startsWith("0x") && value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function deployedContractKey(contract: DevDeployedContract): string {
  return `${deployedNetworkKey(contract)}:${contract.address.toLowerCase()}:${contract.contract}`;
}

function deployedNetworkKey(contract: DevDeployedContract): string {
  const chainId = contract.chainId ?? chainIdFromFingerprint(contract.networkFingerprint);
  return chainId === null ? contract.networkFingerprint ?? contract.network ?? "-" : `chain:${chainId}`;
}

function chainIdFromFingerprint(fingerprint: string | null | undefined): string | null {
  const match = fingerprint?.match(/^[^:]+:(\d+):/);
  return match?.[1] ?? null;
}

function accountTitleParts(name: string, address: string, signer: string): readonly SelectorOptionPart[] {
  return [
    { text: padEnd(name, 14), kind: "selected" },
    { text: `${padEnd(address, 20)} `, kind: "address" },
    { text: signer, kind: "muted" },
  ];
}

function accountDetailParts(balance: string): readonly SelectorOptionPart[] {
  return [
    { text: balance, kind: balance === "balance unavailable" ? "warning" : "balance" },
  ];
}

function deployedAbiSummary(contract: DevDeployedContract): string {
  return `${contract.abiSummary.functions} functions / ${contract.abiSummary.events} events / ${contract.abiSummary.errors} errors`;
}

function deployedNetworkLabel(contract: DevDeployedContract): string {
  return [
    contract.network ?? "-",
    contract.chainId === null ? null : `#${contract.chainId}`,
  ].filter((part): part is string => part !== null && part.length > 0).join(" ");
}

function previewInfoRow(label: string, value: string, kind: NonNullable<SelectorOptionPart["kind"]>): readonly SelectorOptionPart[] {
  return [
    { text: `${padEnd(label, 8)} `, kind: "muted" },
    { text: value, kind },
  ];
}

function functionPreviewLine(item: DevDeployedContract["functions"][number]): string {
  const mutability = item.state_mutability === "view" || item.state_mutability === "pure" || item.state_mutability === "payable"
    ? ` ${item.state_mutability}`
    : "";
  const outputs = item.outputs.length === 0 ? "" : ` returns (${item.outputs.map((output) => output.kind).join(", ")})`;
  return `function ${item.signature}${mutability}${outputs};`;
}

function padEnd(value: string, length: number): string {
  return value.length >= length ? value : `${value}${" ".repeat(length - value.length)}`;
}

function currentUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function deployedAbsoluteTime(createdAtUnix: number): string {
  const date = new Date(createdAtUnix * 1000);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function addressFromOption(option: DevAccountOption): string | null {
  for (const value of [option.copyValue, option.label, option.description, option.meta]) {
    const match = value?.match(/0x[a-fA-F0-9]{40}/);
    if (match !== null && match !== undefined) {
      return match[0] ?? null;
    }
  }
  return null;
}

function signerFromOption(option: DevAccountOption): string | null {
  const parts = option.label.split(/\s*\/\s*/).map((part) => part.trim()).filter((part) => part.length > 0);
  return parts.find((part) => !part.startsWith("0x") && part !== option.name) ?? null;
}
