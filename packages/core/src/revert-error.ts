import { decodeErrorResult, type Abi } from "viem";

/**
 * Extracts revert data from an RPC / `cast` error message and decodes it against
 * the error definitions in `abi`, returning a human-readable `Name(arg, ...)`
 * string. Returns null when the message carries no revert data or no error in
 * `abi` matches the selector.
 */
export function decodeRevertError(errorText: string, abi: readonly unknown[]): string | null {
  const data = extractRevertData(errorText);
  if (data === null) {
    return null;
  }

  try {
    const decoded = decodeErrorResult({ abi: abi as Abi, data });
    // Error(string) and Panic(uint256) are Solidity built-ins that viem decodes
    // without a contract ABI; render them the way developers read them.
    if (decoded.errorName === "Panic" && decoded.args?.length === 1) {
      return `Panic(${panicReason(decoded.args[0] as bigint)})`;
    }
    if (decoded.errorName === "Error" && decoded.args?.length === 1) {
      return `Error(${JSON.stringify(decoded.args[0])})`;
    }
    const args = (decoded.args ?? []).map(formatErrorArg).join(", ");
    return `${decoded.errorName}(${args})`;
  } catch {
    return null;
  }
}

// https://docs.soliditylang.org/en/latest/control-structures.html#panic-via-assert-and-error-via-require
const PANIC_REASONS: Record<string, string> = {
  "0x00": "generic compiler panic",
  "0x01": "assert(false)",
  "0x11": "arithmetic overflow or underflow",
  "0x12": "division or modulo by zero",
  "0x21": "conversion to invalid enum value",
  "0x22": "incorrectly encoded storage byte array",
  "0x31": "pop on empty array",
  "0x32": "array index out of bounds",
  "0x41": "excessive memory allocation",
  "0x51": "called an invalid internal function",
};

function panicReason(code: bigint): string {
  const hex = `0x${code.toString(16).padStart(2, "0")}`;
  const reason = PANIC_REASONS[hex];
  return reason === undefined ? hex : `${hex}: ${reason}`;
}

function extractRevertData(errorText: string): `0x${string}` | null {
  // Prefer the `data: "0x..."` payload (selector + encoded args); otherwise fall
  // back to the first 4+ byte hex string in the message.
  const fromData = errorText.match(/data:\s*"?(0x[0-9a-fA-F]+)"?/);
  const hex = fromData?.[1] ?? errorText.match(/0x[0-9a-fA-F]{8,}/)?.[0] ?? null;
  return hex === null ? null : (hex as `0x${string}`);
}

function formatErrorArg(value: unknown): string {
  return typeof value === "bigint" ? value.toString() : String(value);
}
