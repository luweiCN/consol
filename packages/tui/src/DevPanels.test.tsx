/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test";
import { createTranslator } from "@consol/i18n";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { StateDetails, TransactionDetailModal, TransactionsDetails } from "./DevPanels";
import type { DevStateSnapshot, DevTransactionRecord } from "./runtime-types";
import { theme } from "./theme";

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

  test("state storage rows wrap long type labels under the type column", async () => {
    const translate = createTranslator("en-US");
    const snapshot = {
      ...readyState,
      values: [],
      storageValues: [
        {
          id: "storage:nestedBalances",
          kind: "mapping",
          name: "nestedBalances",
          typeLabel: "mapping(address => mapping(uint256 => mapping(bytes32 => uint256)))",
          summary: "2 checked",
          detailAvailable: true,
          checked: 2,
          nonDefault: 1,
        },
      ],
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
        width: 50,
        height: 10,
      },
    );
    await setup.flush();

    const lines = setup.captureCharFrame().split("\n");
    const titleLine = lines.find((line) => line.includes("nestedBalances")) ?? "";
    const wrappedTypeLine = lines.find((line) => line.includes("mapping(bytes32")) ?? "";
    const typeColumn = titleLine.indexOf("(");

    expect(titleLine).toContain("nestedBalances");
    expect(wrappedTypeLine).toContain("mapping(bytes32");
    expect(typeColumn).toBeGreaterThan(0);
    expect(wrappedTypeLine.search(/\S/)).toBe(typeColumn);
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

  test("selected detailed state fields use readable foreground colors", async () => {
    const translate = createTranslator("en-US");
    const snapshot = {
      ...readyState,
      values: [
        {
          name: "blob",
          signature: "blob()",
          output_types: ["bytes"],
          readable: "decoded blob",
          raw: "0x1234",
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
          selectedRowIndex={0}
        />
      ),
      {
        width: 72,
        height: 12,
      },
    );
    await setup.flush();

    const spans = setup.captureSpans().lines.flatMap((line) => line.spans);
    const signatureSpan = spans.find((span) => span.text.includes("signature:"));
    const rawLabelSpan = spans.find((span) => span.text.includes("raw:"));
    const rawValueSpan = spans.find((span) => span.text.includes("0x1234"));

    expect(signatureSpan?.fg?.toString()).toBe(theme.color.text.toString());
    expect(rawLabelSpan?.fg?.toString()).toBe(theme.color.text.toString());
    expect(rawValueSpan?.fg?.toString()).toBe(theme.color.text.toString());
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

  test("selected transaction field labels stay readable", async () => {
    const translate = createTranslator("en-US");
    const record: DevTransactionRecord = {
      id: "tx-selected",
      action: "send",
      contract: "Bank",
      target: "src/Bank.sol:Bank",
      functionName: "withdraw",
      signature: "withdraw(uint256)",
      args: ["1"],
      result: "Bank withdraw(uint256) -> 0xabc",
      rawOutput: null,
      txHash: "0xabc",
      blockNumber: "7",
      confirmations: "1",
      status: "success",
      gasUsed: "31079",
      network: "local",
      chainId: "31337",
      account: "anvil0",
      createdAtUnix: 1_801_526_400,
    };
    const setup = await testRender(
      () => (
        <TransactionsDetails
          records={[record]}
          fallback="empty"
          translate={translate}
          selectedIndex={0}
        />
      ),
      {
        width: 88,
        height: 12,
      },
    );
    await setup.flush();

    const spans = setup.captureSpans().lines.flatMap((line) => line.spans);
    const txLabelSpan = spans.find((span) => span.text.includes("tx:"));
    const networkLabelSpan = spans.find((span) => span.text.includes("network:"));

    expect(txLabelSpan?.fg?.toString()).toBe(theme.color.text.toString());
    expect(networkLabelSpan?.fg?.toString()).toBe(theme.color.text.toString());
  });

  test("transaction list keeps raw JSON out of send row summaries", async () => {
    const translate = createTranslator("en-US");
    const record: DevTransactionRecord = {
      id: "tx-raw-summary",
      action: "send",
      contract: "Bank",
      target: "src/Bank.sol:Bank",
      functionName: "withdraw",
      signature: "withdraw(uint256)",
      args: ["1"],
      result: null,
      rawOutput: "{\"ok\":true,\"data\":{\"hash\":\"0xabc\"}}",
      txHash: "0xabc",
      blockNumber: "7",
      confirmations: "1",
      status: "success",
      gasUsed: "31079",
      network: "local",
      chainId: "31337",
      account: "anvil0",
      createdAtUnix: 1_801_526_400,
    };
    const setup = await testRender(
      () => (
        <TransactionsDetails
          records={[record]}
          fallback="empty"
          translate={translate}
          selectedIndex={0}
        />
      ),
      {
        width: 88,
        height: 12,
      },
    );
    await setup.flush();

    expect(setup.captureCharFrame()).not.toContain("\"ok\"");
  });

  test("transaction detail renders JSON raw output as a formatted code block", async () => {
    const translate = createTranslator("en-US");
    const record: DevTransactionRecord = {
      id: "tx-json",
      action: "send",
      contract: "Bank",
      target: "src/Bank.sol:Bank",
      functionName: "withdraw",
      signature: "withdraw(uint256)",
      args: ["1"],
      result: "Bank withdraw(uint256) -> 0xabc",
      rawOutput: JSON.stringify({
        ok: true,
        data: {
          hash: "0xabc",
          payload: `${"alpha ".repeat(18)}wrapped-marker`,
          count: 2,
        },
      }),
      txHash: "0xabc",
      blockNumber: "7",
      confirmations: "1",
      status: "success",
      gasUsed: "31079",
      network: "local",
      chainId: "31337",
      account: "anvil0",
      createdAtUnix: 1_801_526_400,
    };
    const setup = await testRender(
      () => (
        <TransactionDetailModal
          record={record}
          translate={translate}
          rect={{ left: 1, top: 1, width: 86, height: 46 }}
        />
      ),
      {
        width: 90,
        height: 50,
      },
    );
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("raw output:");
    expect(frame).toContain("{");
    expect(frame).toContain("  \"ok\": true,");
    expect(frame).toContain("    \"hash\": \"0xabc\"");
    expect(frame).toContain("wrapped-marker");
    expect(frame).not.toContain("raw output: {\"ok\":true");
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
