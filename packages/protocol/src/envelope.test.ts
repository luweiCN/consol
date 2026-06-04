import { describe, expect, test } from "bun:test";
import {
  ErrorEnvelopeSchema,
  SuccessEnvelopeSchema,
  createErrorEnvelope,
  createSuccessEnvelope,
} from "./envelope";
import { createUserError } from "./errors";

describe("JSON envelope contract", () => {
  test("creates stable success envelopes", () => {
    const envelope = createSuccessEnvelope({
      data: { status: "success" },
      meta: { version: "0.10.0", command: "build", project_root: "<SANDBOX>" },
    });

    expect(SuccessEnvelopeSchema.parse(envelope)).toEqual({
      ok: true,
      data: { status: "success" },
      error: null,
      meta: { version: "0.10.0", command: "build", project_root: "<SANDBOX>" },
    });
  });

  test("creates stable error envelopes", () => {
    const error = createUserError({
      code: "foundry_project_not_found",
      message: "No foundry.toml was found for the current directory.",
      hint: "Run inside a Foundry project.",
    });

    const envelope = createErrorEnvelope({
      error,
      meta: { version: "0.10.0", command: "build" },
    });

    expect(ErrorEnvelopeSchema.parse(envelope)).toEqual({
      ok: false,
      data: null,
      error: {
        code: "foundry_project_not_found",
        message: "No foundry.toml was found for the current directory.",
        hint: "Run inside a Foundry project.",
        details: {},
      },
      meta: { version: "0.10.0", command: "build" },
    });
  });
});
