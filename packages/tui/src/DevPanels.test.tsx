/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test";
import { createTranslator } from "@consol/i18n";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
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
  storageValues: [
    {
      id: "storage:numbers",
      kind: "array",
      name: "numbers",
      typeLabel: "uint256[]",
      summary: "len=4 [1, 2, 3, ...]",
      detailAvailable: true,
    },
    {
      id: "storage:balances",
      kind: "mapping",
      name: "balances",
      typeLabel: "mapping(address => uint256)",
      summary: "3 checked, all default",
      detailAvailable: true,
      checked: 3,
      nonDefault: 0,
      defaultValuesHidden: true,
    },
  ],
  storageHints: ["mapping default values hidden; Enter shows checked keys"],
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

  test("state values show type in the title and wrap long decoded values", async () => {
    const translate = createTranslator("en-US");
    const longDecoded = `${"alpha ".repeat(14)}middle-marker ${"omega ".repeat(10)}`;
    const snapshot = {
      ...readyState,
      values: [
        {
          name: "longValue",
          signature: "longValue()",
          output_types: ["string"],
          readable: longDecoded,
          raw: "0x",
        },
      ],
      storageValues: [],
    } as const satisfies DevStateSnapshot;
    const setup = await testRender(
      () => (
        <StateDetails
          snapshot={snapshot}
          fallback="loading"
          translate={translate}
          activeDeployedContract={null}
          showRawValues={false}
        />
      ),
      {
        width: 44,
        height: 10,
      },
    );
    await setup.flush();

    const frame = setup.captureCharFrame();
    const lines = frame.split("\n");
    const decodedLineIndex = lines.findIndex((line) => line.includes("decoded:"));
    const firstValueColumn = lines[decodedLineIndex]?.indexOf("alpha") ?? -1;
    const wrappedValueColumn = lines[decodedLineIndex + 1]?.indexOf("alpha") ?? -1;

    expect(frame).toContain("longValue (string)");
    expect(frame).toContain("marker");
    expect(frame).not.toContain("type: string");
    expect(firstValueColumn).toBeGreaterThan(0);
    expect(wrappedValueColumn).toBe(firstValueColumn);
  });

  test("state values show signatures and raw values in detailed mode", async () => {
    const translate = createTranslator("en-US");
    const longRaw = `0x${"1234567890abcdef".repeat(8)}`;
    const snapshot = {
      ...readyState,
      values: [
        {
          name: "blob",
          signature: "blob()",
          output_types: ["bytes"],
          readable: "decoded blob",
          raw: longRaw,
        },
      ],
      storageValues: [],
    } as const satisfies DevStateSnapshot;
    const setup = await testRender(
      () => (
        <StateDetails
          snapshot={snapshot}
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
    const lines = frame.split("\n");
    const rawLineIndex = lines.findIndex((line) => line.includes("raw:"));
    const rawValueColumn = lines[rawLineIndex]?.indexOf("0x") ?? -1;
    const wrappedRawColumn = lines[rawLineIndex + 1]?.search(/\S/) ?? -1;

    expect(frame).toContain("signature: blob()");
    expect(frame).toContain("raw: 0x");
    expect(rawValueColumn).toBeGreaterThan(0);
    expect(wrappedRawColumn).toBe(rawValueColumn);
  });

  test("state refresh preserves manual scroll position", async () => {
    const translate = createTranslator("en-US");
    const [snapshot, setSnapshot] = createSignal<DevStateSnapshot>(stateSnapshotWithRows("initial"));
    const setup = await testRender(
      () => (
        <StateDetails
          snapshot={snapshot()}
          fallback="loading"
          translate={translate}
          activeDeployedContract={null}
          showRawValues={false}
          selectedRowIndex={0}
        />
      ),
      {
        width: 52,
        height: 8,
        useMouse: true,
      },
    );
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("value00");

    for (let index = 0; index < 10; index += 1) {
      await setup.mockMouse.scroll(10, 4, "down");
      await setup.renderOnce();
    }
    await setup.flush();
    const scrolledFrame = setup.captureCharFrame();
    expect(scrolledFrame).not.toContain("value00");

    setSnapshot(stateSnapshotWithRows("refreshed"));
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).not.toContain("value00");
  });

  test("state details render complex storage rows", async () => {
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
        width: 90,
        height: 16,
      },
    );
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("numbers");
    expect(frame).toContain("len=4");
    expect(frame).toContain("balances");
    expect(frame).toContain("mapping default values hidden");
  });
});

function stateSnapshotWithRows(prefix: string): DevStateSnapshot {
  return {
    ...readyState,
    values: Array.from({ length: 24 }, (_, index) => {
      const suffix = String(index).padStart(2, "0");
      return {
        name: `value${suffix}`,
        signature: `value${suffix}()`,
        output_types: ["uint256"],
        readable: `${prefix}-${index}`,
        raw: `0x${index.toString(16)}`,
      };
    }),
    storageValues: [],
  };
}
