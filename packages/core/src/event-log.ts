import { decodeEventLog, type Abi, type Hex } from "viem";

/**
 * Decodes an event log's arguments (both indexed and non-indexed) against a
 * single event ABI item, returning the values in input order as display
 * strings. Returns null when the topics/data do not match the event.
 */
export function decodeEventLogArgs(
  abiEvent: unknown,
  topics: readonly string[],
  data: string,
): readonly string[] | null {
  const names = eventInputNames(abiEvent);
  if (names === null) {
    return null;
  }

  try {
    const decoded = decodeEventLog({
      abi: [abiEvent] as Abi,
      topics: topics as [Hex, ...Hex[]],
      data: (data.length > 0 ? data : "0x") as Hex,
    });
    const args = decoded.args as Record<string, unknown> | readonly unknown[] | undefined;
    return names.map((name, index) => formatLogValue(argValue(args, name, index)));
  } catch {
    return null;
  }
}

function eventInputNames(abiEvent: unknown): readonly string[] | null {
  if (typeof abiEvent !== "object" || abiEvent === null) {
    return null;
  }
  const inputs = (abiEvent as { inputs?: unknown }).inputs;
  if (!Array.isArray(inputs)) {
    return null;
  }
  return inputs.map((input, index) => {
    const name = typeof input === "object" && input !== null ? (input as { name?: unknown }).name : undefined;
    return typeof name === "string" && name.length > 0 ? name : String(index);
  });
}

function argValue(
  args: Record<string, unknown> | readonly unknown[] | undefined,
  name: string,
  index: number,
): unknown {
  if (args === undefined) {
    return undefined;
  }
  return Array.isArray(args) ? args[index] : (args as Record<string, unknown>)[name];
}

function formatLogValue(value: unknown): string {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatLogValue).join(", ")}]`;
  }
  return String(value);
}
