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
  test("state values keep one blank row between records when raw values are hidden", async () => {
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
    const signatureIndex = lines.findIndex((line) => line.includes("signature: number()"));
    const nextValueIndex = lines.findIndex((line) => line.includes("owner"));
    const blankRows = lines
      .slice(signatureIndex + 1, nextValueIndex)
      .filter((line) => line.trim().length === 0);

    expect(signatureIndex).toBeGreaterThan(-1);
    expect(nextValueIndex).toBeGreaterThan(signatureIndex);
    expect(blankRows).toHaveLength(1);
  });
});
