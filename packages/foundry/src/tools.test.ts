import { describe, expect, test } from "bun:test";
import { createFakeFoundry } from "@consol/testkit";
import { detectFoundryTools } from "./tools";

describe("Foundry tools", () => {
  test("detects forge cast and anvil versions through the adapter layer", async () => {
    const fake = createFakeFoundry();

    await expect(detectFoundryTools({ cwd: fake.root, env: fake.env })).resolves.toEqual({
      forge: { available: true, version: "forge 1.0.0" },
      cast: { available: true, version: "cast 1.0.0" },
      anvil: { available: true, version: "anvil 1.0.0" },
    });

    expect(fake.readCalls().map((call) => [call.tool, call.args])).toEqual([
      ["forge", ["--version"]],
      ["cast", ["--version"]],
      ["anvil", ["--version"]],
    ]);
  });
});
