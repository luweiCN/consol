import { describe, expect, test } from "bun:test";
import { decodeRevertError } from "./revert-error";

const BANK_ERROR_ABI = [
  { type: "error", name: "InsufficientBalance", inputs: [{ name: "balance", type: "uint256" }] },
  { type: "error", name: "Unauthorized", inputs: [{ name: "caller", type: "address" }] },
];

describe("decodeRevertError", () => {
  test("decodes a custom error and its args from cast estimate stderr", () => {
    const errorText =
      'server returned an error response: error code 3: execution reverted: custom error 0x92665351: , data: "0x926653510000000000000000000000000000000000000000000000000000000000000000"';
    expect(decodeRevertError(errorText, BANK_ERROR_ABI)).toBe("InsufficientBalance(0)");
  });

  test("decodes an address argument with a checksummed value", () => {
    const errorText =
      'execution reverted: data: "0x8e4a23d600000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8"';
    expect(decodeRevertError(errorText, BANK_ERROR_ABI)).toBe(
      "Unauthorized(0x70997970C51812dc3A010C7d01b50e0d17dc79C8)",
    );
  });

  test("returns null when the revert data matches no known error", () => {
    const errorText = 'execution reverted, data: "0xdeadbeef00000000000000000000000000000000000000000000000000000000"';
    expect(decodeRevertError(errorText, BANK_ERROR_ABI)).toBe(null);
  });

  test("returns null when the text carries no revert data", () => {
    expect(decodeRevertError("execution reverted: out of gas", BANK_ERROR_ABI)).toBe(null);
  });

  test("decodes a standard require reason via the built-in Error(string)", () => {
    const errorText =
      'execution reverted, data: "0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000f5472616e73666572206661696c65640000000000000000000000000000000000"';
    expect(decodeRevertError(errorText, [])).toBe('Error("Transfer failed")');
  });

  test("decodes a Panic with a human-readable reason", () => {
    const errorText =
      'execution reverted, data: "0x4e487b710000000000000000000000000000000000000000000000000000000000000011"';
    expect(decodeRevertError(errorText, [])).toBe("Panic(0x11: arithmetic overflow or underflow)");
  });
});
