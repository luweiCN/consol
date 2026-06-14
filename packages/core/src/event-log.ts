import { decodeEventLog as viemDecodeEventLog, type Abi, type Hex } from "viem";

export type DecodedEventArg = {
  readonly name: string;
  readonly type: string;
  readonly indexed: boolean;
  readonly value: string;
};

export type DecodedEvent = {
  readonly eventName: string;
  readonly args: readonly DecodedEventArg[];
};

/**
 * Decodes an event log against a full contract ABI: matches the event by its
 * topic0 signature and returns the event name plus typed, named args (both
 * indexed and non-indexed). Returns null when no event in the ABI matches.
 */
export function decodeEventLog(
  abi: readonly unknown[],
  topics: readonly string[],
  data: string,
): DecodedEvent | null {
  try {
    const decoded = viemDecodeEventLog({
      abi: abi as Abi,
      topics: topics as [Hex, ...Hex[]],
      data: (data.length > 0 ? data : "0x") as Hex,
    });
    const eventName = decoded.eventName;
    if (eventName === undefined) {
      return null;
    }
    const inputs = eventInputs(abi.find((item) => isEventNamed(item, eventName)));
    const args = decoded.args as Record<string, unknown> | readonly unknown[] | undefined;
    return {
      eventName,
      args: inputs.map((input, index) => ({
        name: input.name.length > 0 ? input.name : String(index),
        type: input.type,
        indexed: input.indexed,
        value: formatLogValue(argValue(args, input.name, index)),
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Decodes a single event's args in input order as display strings. Convenience
 * wrapper over decodeEventLog for callers that already matched the event item.
 */
export function decodeEventLogArgs(
  abiEvent: unknown,
  topics: readonly string[],
  data: string,
): readonly string[] | null {
  const decoded = decodeEventLog([abiEvent], topics, data);
  return decoded === null ? null : decoded.args.map((arg) => arg.value);
}

function isEventNamed(item: unknown, name: string): boolean {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as { type?: unknown }).type === "event" &&
    (item as { name?: unknown }).name === name
  );
}

function eventInputs(item: unknown): readonly { name: string; type: string; indexed: boolean }[] {
  if (typeof item !== "object" || item === null) {
    return [];
  }
  const inputs = (item as { inputs?: unknown }).inputs;
  if (!Array.isArray(inputs)) {
    return [];
  }
  return inputs.map((input) => ({
    name: typeof (input as { name?: unknown })?.name === "string" ? (input as { name: string }).name : "",
    type: typeof (input as { type?: unknown })?.type === "string" ? (input as { type: string }).type : "",
    indexed: (input as { indexed?: unknown })?.indexed === true,
  }));
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
