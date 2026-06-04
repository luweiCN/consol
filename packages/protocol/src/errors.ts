import { z } from "zod";

export const ErrorDetailsSchema = z.record(z.string(), z.unknown());

export const ConsolErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  hint: z.string().min(1).optional(),
  details: ErrorDetailsSchema,
});

export type ConsolError = z.infer<typeof ConsolErrorSchema>;

export type CreateUserErrorInput = {
  readonly code: string;
  readonly message: string;
  readonly hint?: string;
  readonly details?: Readonly<Record<string, unknown>>;
};

export function createUserError(input: CreateUserErrorInput): ConsolError {
  return {
    code: input.code,
    message: input.message,
    ...(input.hint === undefined ? {} : { hint: input.hint }),
    details: input.details === undefined ? {} : { ...input.details },
  };
}
