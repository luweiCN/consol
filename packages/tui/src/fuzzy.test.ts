import { describe, expect, test } from "bun:test";
import { fuzzyFilter } from "./fuzzy";

describe("fuzzyFilter", () => {
  const options = [
    { name: "local", label: "local / anvil" },
    { name: "day01", label: "courses/solidity-30days/contracts/day-01-ClickCounter.sol:ClickCounter" },
    { name: "day10", label: "courses/solidity-30days/contracts/day-10-ActivityTracker.sol:ActivityTracker" },
    { name: "day30", label: "courses/solidity-30days/contracts/day-30-MiniDexFactory.sol:MiniDexFactory" },
  ] as const;

  test("matches contract names, filenames, extensions, and skipped path initials", () => {
    expect(fuzzyFilter(options, "ClickCounter").map((option) => option.name)).toEqual(["day01"]);
    expect(fuzzyFilter(options, "day-01").map((option) => option.name)[0]).toBe("day01");
    expect(fuzzyFilter(options, "sol").map((option) => option.name)).toEqual(["day01", "day10", "day30"]);
    expect(fuzzyFilter(options, "d1cc").map((option) => option.name)[0]).toBe("day01");
  });

  test("keeps empty query order", () => {
    expect(fuzzyFilter(options, "").map((option) => option.name)).toEqual(["local", "day01", "day10", "day30"]);
  });
});
