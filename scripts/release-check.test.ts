import { describe, expect, test } from "bun:test";
import { releaseCheckCommands } from "./release-check";

describe("release check command plan", () => {
  test("runs every pre-release gate in order", () => {
    expect(releaseCheckCommands.map((command) => command.join(" "))).toEqual([
      "bun install --frozen-lockfile",
      "bun run verify",
      "bun run package:build",
      "bun run package:smoke",
      "git diff --check",
    ]);
  });
});
