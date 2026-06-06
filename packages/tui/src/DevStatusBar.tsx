/** @jsxImportSource @opentui/solid */
import type { MessageKey } from "@consol/i18n";
import type { ColorInput } from "@opentui/core";
import { createMemo } from "solid-js";
import type { DevAccountStatusSnapshot } from "./runtime-types";
import type { SelectorOption } from "./SelectorModal";
import { theme } from "./theme";

export function StatusBar(props: {
  readonly network: SelectorOption;
  readonly account: SelectorOption;
  readonly compact: boolean;
  readonly accountStatus?: DevAccountStatusSnapshot;
  readonly translate: (key: MessageKey, values?: Record<string, string | number>) => string;
}) {
  const network = createMemo(() => networkStatusParts(props.network));
  const account = createMemo(() => accountStatusParts(props.account));
  const balance = createMemo(() => accountBalanceStatus(props.accountStatus, props.network.name, props.account.name, props.translate));
  const networkLabel = () => props.translate("tui.status.networkShort");
  const accountLabel = () => props.translate("tui.status.accountShort");

  if (props.compact) {
    return (
      <box width="100%" height="100%" flexDirection="row" columnGap={0}>
        <text flexShrink={0} fg={theme.color.muted} content={`${networkLabel()} `} />
        <text flexShrink={0} fg={theme.color.selected} content={`[${network().name}]`} />
        <text flexShrink={0} fg={theme.color.code} content={network().chain === "" ? "" : `(#${network().chain})`} />
        <text flexShrink={0} fg={theme.color.muted} content={network().meta === "" ? "" : `{${network().meta}}`} />
        <text flexShrink={0} fg={theme.color.border} content=" | " />
        <text flexShrink={0} fg={theme.color.muted} content={`${accountLabel()} `} />
        <text flexShrink={0} fg={theme.color.selected} content={`[${account().primary}]`} />
        <text flexShrink={0} fg={theme.color.code} content={addressStatusPart(account().address)} />
        <text flexShrink={0} fg={theme.color.muted} content={signerStatusPart(account().signer)} />
        <text flexShrink={0} fg={balance().fg} content={balance().content} />
      </box>
    );
  }

  return (
    <box width="100%" height="100%" flexDirection="column" rowGap={0}>
      <box height={1} flexDirection="row" columnGap={0}>
        <text flexShrink={0} fg={theme.color.muted} content={`${networkLabel()} `} />
        <text flexShrink={0} fg={theme.color.selected} content={`[${network().name}]`} />
        <text flexShrink={0} fg={theme.color.code} content={network().chain === "" ? "" : `(#${network().chain})`} />
        <text flexShrink={0} fg={theme.color.muted} content={network().meta === "" ? "" : `{${network().meta}}`} />
      </box>
      <box height={1} flexDirection="row" columnGap={0}>
        <text flexShrink={0} fg={theme.color.muted} content={`${accountLabel()} `} />
        <text flexShrink={0} fg={theme.color.selected} content={`[${account().primary}]`} />
        <text flexShrink={0} fg={theme.color.code} content={addressStatusPart(account().address)} />
        <text flexShrink={0} fg={theme.color.muted} content={signerStatusPart(account().signer)} />
        <text flexShrink={0} fg={theme.color.muted} content={account().meta === "" ? "" : ` ${account().meta}`} />
        <text flexShrink={0} fg={balance().fg} content={balance().content} />
      </box>
    </box>
  );
}

export function accountAddressFromOption(option: SelectorOption | undefined): string | null {
  if (option === undefined) {
    return null;
  }

  for (const value of [option.copyValue, option.label, option.description, option.meta]) {
    const address = fullAddressFromText(value);
    if (address !== null) {
      return address;
    }
  }

  return null;
}

function accountBalanceStatus(
  status: DevAccountStatusSnapshot | undefined,
  networkName: string,
  accountName: string,
  translate: (key: MessageKey, values?: Record<string, string | number>) => string,
): { readonly fg: ColorInput; readonly content: string } {
  if (status === undefined || status.networkName !== networkName || status.accountName !== accountName) {
    return { fg: theme.color.muted, content: "" };
  }

  if (status.status === "ok") {
    const balance = status.balanceDisplay ?? status.balanceWei ?? "";
    const gwei = balanceGweiStatus(status.balanceWei);
    return { fg: theme.color.read, content: balance === "" ? "" : ` ${balance}${gwei === null ? "" : ` (${gwei})`}` };
  }

  return { fg: theme.color.danger, content: ` ${translate("tui.status.balanceUnavailable")}` };
}

function balanceGweiStatus(wei: string | null): string | null {
  if (wei === null || !/^[0-9]+$/.test(wei)) {
    return null;
  }

  return formatFixedDecimalUnit(wei, 9, "gwei");
}

function formatFixedDecimalUnit(wei: string, decimals: number, symbol: string, fractionDigits = 4): string {
  const padded = wei.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals).replace(/^0+(?=\d)/, "");
  const fraction = padded.slice(-decimals).padEnd(fractionDigits, "0").slice(0, fractionDigits);
  return `${whole}.${fraction} ${symbol}`;
}

function statusParts(option: SelectorOption): {
  readonly primary: string;
  readonly secondary: readonly string[];
  readonly meta: string;
} {
  const parts = option.label.split(/\s*\/\s*/).map((part) => part.trim()).filter((part) => part.length > 0);
  return {
    primary: parts[0] ?? option.name,
    secondary: parts.slice(1),
    meta: option.meta?.trim() ?? "",
  };
}

function accountStatusParts(option: SelectorOption): {
  readonly primary: string;
  readonly address: string | undefined;
  readonly signer: string | undefined;
  readonly meta: string;
} {
  const parts = statusParts(option);
  const address = parts.secondary.find((part) => part.startsWith("0x"));
  const signer = parts.secondary.find((part) => !part.startsWith("0x"));
  return {
    primary: parts.primary,
    address,
    signer,
    meta: parts.meta,
  };
}

function shortSignerSource(value: string): string {
  return value === "anvil-index" ? "anvil" : value === "env-private-key" ? "env-key" : value;
}

function shortStatusAddress(value: string): string {
  return value.startsWith("0x") && value.length > 12 ? `${value.slice(0, 6)}..${value.slice(-2)}` : value;
}

function addressStatusPart(value: string | undefined): string {
  return value === undefined ? "" : `(${shortStatusAddress(value)})`;
}

function signerStatusPart(value: string | undefined): string {
  return value === undefined ? "" : `{${shortSignerSource(value)}}`;
}

function networkStatusParts(option: SelectorOption): {
  readonly name: string;
  readonly chain: string;
  readonly meta: string;
} {
  const parts = option.label.split(/\s*\/\s*/).map((part) => part.trim()).filter((part) => part.length > 0);
  const first = parts[0] ?? option.name;
  const match = first.match(/^(.*)\s+#([^#\s]+)$/);
  const name = match?.[1]?.trim() ?? first;
  const chain = match?.[2] ?? "";
  const meta = [parts.slice(1).join("/"), option.meta?.trim() ?? ""].filter((part) => part.length > 0).join("/");
  return {
    name,
    chain,
    meta,
  };
}

export function fullAddressFromText(value: string | undefined): string | null {
  const match = value?.match(/0x[a-fA-F0-9]{40}/);
  return match?.[0] ?? null;
}
