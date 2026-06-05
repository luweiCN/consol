import { describe, expect, test } from "bun:test";
import { formatDecimalUnit } from "./dev";

describe("dev formatting helpers", () => {
  test("formatDecimalUnit handles zero-decimal units", () => {
    expect(formatDecimalUnit("42", 0, "unit")).toBe("42 unit");
  });
});
