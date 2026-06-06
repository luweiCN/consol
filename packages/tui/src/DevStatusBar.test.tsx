/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test";
import { createTranslator } from "@consol/i18n";
import { testRender } from "@opentui/solid";
import { StatusBar } from "./DevStatusBar";

describe("StatusBar", () => {
  test("wraps long network text under the status value column", async () => {
    const translate = createTranslator("en-US");
    const setup = await testRender(
      () => (
        <StatusBar
          compact={false}
          network={{
            name: "long-network",
            label: "a-very-long-network-name alpha beta gamma #31337 / rpc-path-wrapped-marker",
            active: true,
          }}
          account={{
            name: "anvil0",
            label: "anvil0 / 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 / anvil-index",
            active: true,
          }}
          translate={translate}
        />
      ),
      {
        width: 44,
        height: 5,
      },
    );
    await setup.flush();

    const lines = setup.captureCharFrame().split("\n");
    const networkLine = lines.find((line) => line.includes("network [a-very-long-network")) ?? "";
    const wrappedLine = lines.find((line) => line.includes("wrapped-marker")) ?? "";
    const valueColumn = networkLine.indexOf("[a-very-long-network");

    expect(networkLine).toContain("network ");
    expect(wrappedLine).toContain("wrapped-marker");
    expect(valueColumn).toBeGreaterThan(0);
    expect(wrappedLine.search(/\S/)).toBe(valueColumn);
  });

  test("wraps long account text under the status value column without hard-cutting words", async () => {
    const translate = createTranslator("en-US");
    const setup = await testRender(
      () => (
        <StatusBar
          compact={false}
          network={{
            name: "local",
            label: "local #31337 / anvil",
            active: true,
          }}
          account={{
            name: "long-account",
            label: "long-account / 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 / signer alpha beta account-wrapped-marker",
            active: true,
          }}
          translate={translate}
        />
      ),
      {
        width: 44,
        height: 6,
      },
    );
    await setup.flush();

    const lines = setup.captureCharFrame().split("\n");
    const accountLine = lines.find((line) => line.includes("account [long-account]")) ?? "";
    const wrappedLine = lines.find((line) => line.includes("account-wrapped-marker")) ?? "";
    const valueColumn = accountLine.indexOf("[long-account]");

    expect(accountLine).toContain("account ");
    expect(wrappedLine).toContain("account-wrapped-marker");
    expect(valueColumn).toBeGreaterThan(0);
    expect(wrappedLine.search(/\S/)).toBe(valueColumn);
    expect(lines.some((line) => line.includes("account-wrapped-mar"))).toBe(true);
    expect(lines.some((line) => line.includes("account-wrapped-\n"))).toBe(false);
  });
});
