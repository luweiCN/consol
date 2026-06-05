/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test";
import { createTranslator } from "@consol/i18n";
import { testRender } from "@opentui/solid";
import { StateDetails } from "./DevPanels";
import type { DevStateSnapshot } from "./runtime-types";

const readyState = {
  status: {
    status: "ready",
    message: "ready",
    hint: null,
  },
  address: null,
  values: [
    {
      name: "number",
      signature: "number()",
      output_types: ["uint256"],
      readable: "42",
      raw: "0x2a",
    },
    {
      name: "owner",
      signature: "owner()",
      output_types: ["address"],
      readable: "0x000000000000000000000000000000000000c0fe",
      raw: "0x000000000000000000000000000000000000c0fe",
    },
  ],
} as const satisfies DevStateSnapshot;

describe("DevPanels", () => {
  test("state values hide signature and blank rows in compact mode", async () => {
    const translate = createTranslator("en-US");
    const setup = await testRender(
      () => (
        <StateDetails
          snapshot={readyState}
          fallback="loading"
          translate={translate}
          activeDeployedContract={null}
          showRawValues={false}
        />
      ),
      {
        width: 72,
        height: 12,
      },
    );
    await setup.flush();

    const lines = setup.captureCharFrame().split("\n");
    const firstValueIndex = lines.findIndex((line) => line.includes("number"));
    const nextValueIndex = lines.findIndex((line) => line.includes("owner"));
    const blankRows = lines
      .slice(firstValueIndex + 1, nextValueIndex)
      .filter((line) => line.trim().length === 0);

    expect(firstValueIndex).toBeGreaterThan(-1);
    expect(nextValueIndex).toBeGreaterThan(firstValueIndex);
    expect(setup.captureCharFrame()).not.toContain("signature:");
    expect(setup.captureCharFrame()).not.toContain("raw:");
    expect(blankRows).toHaveLength(0);
  });

  test("state values show signatures and raw values in detailed mode", async () => {
    const translate = createTranslator("en-US");
    const setup = await testRender(
      () => (
        <StateDetails
          snapshot={readyState}
          fallback="loading"
          translate={translate}
          activeDeployedContract={null}
          showRawValues
        />
      ),
      {
        width: 72,
        height: 12,
      },
    );
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("signature: number()");
    expect(frame).toContain("raw: 0x2a");
  });
});
