import { z } from "zod";

export const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const WritePolicySchema = z.enum(["local", "confirm", "typed-confirm", "read-only"]);

export const NetworkSchema = z.object({
  name: z.string().min(1),
  chainId: z.number().int().positive(),
  fingerprint: z.string().min(1),
  writePolicy: WritePolicySchema,
});

export const AccountSchema = z.object({
  name: z.string().min(1).optional(),
  address: AddressSchema,
});

export const SignerSchema = z.object({
  name: z.string().min(1),
  source: z.enum(["anvil-index", "env-private-key", "keystore", "unknown"]),
  address: AddressSchema.optional(),
  available: z.boolean(),
});

export const TargetSchema = z.object({
  display: z.string().min(1),
  contract: z.string().min(1),
  sourceMode: z.enum(["project", "single_file"]),
  sourceFile: z.string().min(1).optional(),
});

export const CalldataSchema = z.object({
  function: z.string().min(1),
  signature: z.string().min(1).optional(),
  args: z.array(z.string()),
  hex: z.string().regex(/^0x[a-fA-F0-9]*$/),
});

export const GasSourceSchema = z.enum([
  "actual",
  "rpc_estimate",
  "compiler_estimate",
  "test_report",
  "snapshot_delta",
]);

export const GasSchema = z.object({
  source: GasSourceSchema,
  estimate: z.union([z.string(), z.number()]).optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const TxPreviewFollowupSchema = z.object({
  action: z.enum(["read", "send"]),
  calldata: CalldataSchema,
  value: z.string().nullable().optional(),
  gas: GasSchema.optional(),
});

export const TxPreviewEventSchema = z.object({
  type: z.literal("tx.preview"),
  id: z.string().min(1),
  timestamp: z.string().min(1),
  action: z.enum(["deploy", "read", "send"]),
  network: NetworkSchema,
  account: AccountSchema,
  signer: SignerSchema,
  target: TargetSchema,
  calldata: CalldataSchema,
  value: z.string().nullable().optional(),
  gas: GasSchema,
  followup: TxPreviewFollowupSchema.optional(),
});

export const TxSentEventSchema = z.object({
  type: z.literal("tx.sent"),
  id: z.string().min(1),
  timestamp: z.string().min(1),
  hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  network: NetworkSchema,
});

export const TxMinedEventSchema = z.object({
  type: z.literal("tx.mined"),
  id: z.string().min(1),
  timestamp: z.string().min(1),
  hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  status: z.enum(["success", "reverted"]),
  gas: GasSchema,
});

export const ErrorEventSchema = z.object({
  type: z.literal("error"),
  id: z.string().min(1),
  timestamp: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["error", "warning"]),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const ConsolEventSchema = z.discriminatedUnion("type", [
  TxPreviewEventSchema,
  TxSentEventSchema,
  TxMinedEventSchema,
  ErrorEventSchema,
]);

export type Address = z.infer<typeof AddressSchema>;
export type Network = z.infer<typeof NetworkSchema>;
export type Account = z.infer<typeof AccountSchema>;
export type Signer = z.infer<typeof SignerSchema>;
export type Gas = z.infer<typeof GasSchema>;
export type TxPreviewEvent = z.infer<typeof TxPreviewEventSchema>;
export type TxPreviewFollowup = z.infer<typeof TxPreviewFollowupSchema>;
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
export type ConsolEvent = z.infer<typeof ConsolEventSchema>;
