export type NetworkKind = "anvil" | "anvil-fork" | "remote";
export type WritePolicy = "local" | "confirm" | "typed-confirm" | "read-only";

export type DefaultWritePolicyInput = {
  readonly kind?: NetworkKind;
  readonly chainId?: number;
};

export function detectNetworkKind(rpcUrl: string): NetworkKind {
  return isLocalRpc(rpcUrl) ? "anvil" : "remote";
}

export function redactRpcUrl(rpcUrl: string): string {
  const value = rpcUrl.trim();
  if (value.length === 0 || isLocalRpc(value)) {
    return value;
  }

  const [scheme, rest] = value.includes("://") ? splitOnce(value, "://") : ["", value];
  const splitAt = rest.search(/[/?#]/);
  const authority = splitAt === -1 ? rest : rest.slice(0, splitAt);
  const suffix = splitAt === -1 ? "" : rest.slice(splitAt);
  const safeAuthority = authority.split("@").at(-1) ?? authority;
  const prefix = scheme.length === 0 ? safeAuthority : `${scheme}://${safeAuthority}`;
  return suffix.length === 0 || suffix === "/" ? prefix : `${prefix}/<redacted>`;
}

export function defaultWritePolicy(input: DefaultWritePolicyInput): WritePolicy | undefined {
  if (input.kind === "anvil" || input.kind === "anvil-fork") {
    return "local";
  }

  if (input.chainId === 1) {
    return "typed-confirm";
  }

  if (input.kind !== undefined) {
    return "confirm";
  }

  return undefined;
}

function splitOnce(value: string, separator: string): readonly [string, string] {
  const index = value.indexOf(separator);
  return index === -1 ? [value, ""] : [value.slice(0, index), value.slice(index + separator.length)];
}

function isLocalRpc(rpcUrl: string): boolean {
  return rpcHost(rpcUrl) === "localhost" || rpcHost(rpcUrl) === "127.0.0.1" || rpcHost(rpcUrl) === "::1";
}

function rpcHost(rpcUrl: string): string | undefined {
  const value = rpcUrl.trim();
  const authority = value.split("://").at(-1)?.split(/[/?#]/)[0];
  const hostPort = authority?.split("@").at(-1);
  if (!hostPort) {
    return undefined;
  }

  if (hostPort.startsWith("[")) {
    return hostPort.slice(1).split("]")[0]?.toLowerCase();
  }

  return hostPort.split(":")[0]?.toLowerCase();
}
