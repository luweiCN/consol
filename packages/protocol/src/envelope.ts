import { z } from "zod";
import { ConsolErrorSchema, type ConsolError } from "./errors";

export const NetworkMetaSchema = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  chain_id: z.number().int().positive().nullable(),
  rpc_url: z.string().min(1),
  fork_url: z.string().min(1).nullable(),
  fork_block_number: z.number().int().positive().nullable(),
  fingerprint: z.string().min(1).nullable(),
  write_policy: z.string().min(1),
});

export const AccountMetaSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1).nullable(),
  signer: z.string().min(1),
});

export const MetaSchema = z.object({
  version: z.string().min(1),
  command: z.string().min(1),
  project_root: z.string().min(1).optional(),
  network: NetworkMetaSchema.optional(),
  account: AccountMetaSchema.optional(),
});

export const SuccessEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: z.unknown(),
  error: z.null(),
  meta: MetaSchema,
});

export const ErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  data: z.null(),
  error: ConsolErrorSchema,
  meta: MetaSchema,
});

export const EnvelopeSchema = z.discriminatedUnion("ok", [SuccessEnvelopeSchema, ErrorEnvelopeSchema]);

export type NetworkMeta = z.infer<typeof NetworkMetaSchema>;
export type AccountMeta = z.infer<typeof AccountMetaSchema>;
export type Meta = z.infer<typeof MetaSchema>;
export type SuccessEnvelope = z.infer<typeof SuccessEnvelopeSchema>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export type Envelope = z.infer<typeof EnvelopeSchema>;

export type CreateSuccessEnvelopeInput<T> = {
  readonly data: T;
  readonly meta: Meta;
};

export type CreateErrorEnvelopeInput = {
  readonly error: ConsolError;
  readonly meta: Meta;
};

export function createSuccessEnvelope<T>(input: CreateSuccessEnvelopeInput<T>): SuccessEnvelope {
  return {
    ok: true,
    data: input.data,
    error: null,
    meta: input.meta,
  };
}

export function createErrorEnvelope(input: CreateErrorEnvelopeInput): ErrorEnvelope {
  return {
    ok: false,
    data: null,
    error: input.error,
    meta: input.meta,
  };
}
