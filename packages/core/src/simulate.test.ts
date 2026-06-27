import { describe, expect, test } from "bun:test";
import { simulationOutcome } from "./simulate";

const BANK_ERROR_ABI = [
  { type: "error", name: "InsufficientBalance", inputs: [{ name: "balance", type: "uint256" }] },
];

describe("simulationOutcome", () => {
  test("a successful call reports its return value", () => {
    expect(simulationOutcome({ ok: true, stdout: "true\n", stderr: "" }, [])).toEqual({
      ok: true,
      returnValue: "true",
      reason: null,
    });
  });

  test("a successful call with no return value reports none", () => {
    expect(simulationOutcome({ ok: true, stdout: "", stderr: "" }, [])).toEqual({
      ok: true,
      returnValue: null,
      reason: null,
    });
  });

  test("a reverting call decodes the revert reason", () => {
    const stderr =
      'execution reverted: custom error 0x92665351: , data: "0x926653510000000000000000000000000000000000000000000000000000000000000000"';
    expect(simulationOutcome({ ok: false, stdout: "", stderr }, BANK_ERROR_ABI)).toEqual({
      ok: false,
      returnValue: null,
      reason: "InsufficientBalance(0)",
    });
  });

  test("a reverting call falls back to the raw message when undecodable", () => {
    expect(simulationOutcome({ ok: false, stdout: "", stderr: "execution reverted: out of gas" }, [])).toEqual({
      ok: false,
      returnValue: null,
      reason: "execution reverted: out of gas",
    });
  });
});
