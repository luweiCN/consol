export type NdjsonEventInput = {
  readonly type: string;
  readonly sequence: number;
  readonly data: unknown;
  readonly meta: unknown;
};

export function ndjsonEvent(input: NdjsonEventInput): string {
  return `${JSON.stringify({
    type: input.type,
    sequence: input.sequence,
    timestamp_ms: Date.now(),
    data: input.data,
    meta: input.meta,
  })}\n`;
}
