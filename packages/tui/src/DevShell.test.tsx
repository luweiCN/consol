/** @jsxImportSource @opentui/solid */
import { EventEmitter, setMaxListeners } from "node:events";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createInitialDevState, devReducer, type DevAction, type DevModal, type DevSession } from "@consol/core";
import { createSignal } from "solid-js";
import { DevShell, isExitConfirmKey, type DevShellProps } from "./DevShell";
import type { DevAccountStatusSnapshot, DevDeployedContract, DevSettingsChange, DevSettingsSnapshot, DevTransactionRecord } from "./runtime-types";

EventEmitter.defaultMaxListeners = 200;
setMaxListeners(200);

type TxPreviewEvent = Extract<DevModal, { readonly type: "txPreview" }>["event"];

async function renderShell(
  locale: "en-US" | "zh-CN",
  width = 80,
  height = 24,
  session?: DevSession,
  networkOptions?: DevShellProps["networkOptions"],
  feedEntries?: readonly string[],
  accountOptions?: DevShellProps["accountOptions"],
  modal?: DevModal,
  onConfirmTxPreview?: (event: TxPreviewEvent) => void,
  onCancelModal?: () => void,
  onDevAction?: (action: DevAction) => void,
  entryOptions?: NonNullable<DevShellProps["entryOptions"]>,
  onEntrySelect?: NonNullable<DevShellProps["onEntrySelect"]>,
  stateSnapshot?: DevShellProps["stateSnapshot"],
  transactions?: readonly DevTransactionRecord[],
  deployedContractItems?: readonly DevDeployedContract[],
): Promise<TestRendererSetup> {
  const setup = await testRender(
    () => (
      <DevShell
        locale={locale}
        {...(session === undefined ? {} : { session })}
        {...(networkOptions === undefined ? {} : { networkOptions })}
        {...(feedEntries === undefined ? {} : { feedEntries })}
        {...(accountOptions === undefined ? {} : { accountOptions })}
        {...(modal === undefined ? {} : { modal })}
        {...(onConfirmTxPreview === undefined ? {} : { onConfirmTxPreview })}
        {...(onCancelModal === undefined ? {} : { onCancelModal })}
        {...(onDevAction === undefined ? {} : { onDevAction })}
        {...(entryOptions === undefined ? {} : { entryOptions })}
        {...(onEntrySelect === undefined ? {} : { onEntrySelect })}
        {...(stateSnapshot === undefined ? {} : { stateSnapshot })}
        {...(transactions === undefined ? {} : { transactions })}
        {...(deployedContractItems === undefined ? {} : { deployedContracts: deployedContractItems })}
      />
    ),
    {
      width,
      height,
      useMouse: true,
    },
  );
  await setup.flush();
  return setup;
}

function statusLine(frame: string): string {
  return frame.split("\n").find((line) => line.includes("network [") || line.includes("网络 ")) ?? "";
}

function deployedAgeFromFrame(frame: string): number | null {
  const match = frame.match(/(\d+)秒前/);
  return match?.[1] === undefined ? null : Number(match[1]);
}

function deployedSelectorTitleLine(frame: string): string {
  return frame.split("\n").find((line) => line.includes("›") && line.includes("Counter")) ?? "";
}

function deployedSelectorAddressLine(frame: string): string {
  return frame.split("\n").find((line) => line.includes("0x000000...00c0fe")) ?? "";
}

const networkOptions = [
  { name: "local", label: "local / anvil", active: true },
  { name: "sepolia", label: "sepolia / remote", active: false },
  { name: "mainnet", label: "mainnet / typed-confirm", active: false },
] as const;

const accountOptions = [
  { name: "anvil0", label: "anvil0 / anvil-index", active: false },
  { name: "deployer", label: "deployer / env-private-key", active: true },
] as const;

const detailedNetworkOptions = [
  {
    name: "local",
    label: "local #31337 / anvil / local",
    active: true,
    meta: "rpc: localhost",
  },
] as const;

const detailedAccountOptions = [
  {
    name: "anvil0",
    label: "anvil0 / 0xf39f...2266 / anvil-index",
    active: true,
  },
] as const;

const transactionRecords: readonly DevTransactionRecord[] = [
  {
    id: "tx-1",
    action: "send",
    contract: "Counter",
    target: "src/Counter.sol:Counter",
    functionName: "setNumber",
    signature: "setNumber(uint256)",
    args: ["42"],
    result: null,
    rawOutput: null,
    txHash: `0x${"1".repeat(64)}`,
    blockNumber: "7",
    status: "success",
    gasUsed: "42123",
    network: "local",
    account: "anvil0",
    createdAtUnix: 1_801_526_400,
  },
];

const deployedContracts: readonly DevDeployedContract[] = [
  {
    id: "local:Counter:0x000000000000000000000000000000000000c0fe",
    contract: "Counter",
    address: "0x000000000000000000000000000000000000c0fe",
    target: "src/Counter.sol:Counter",
    sourceFile: "src/Counter.sol",
    network: "local",
    chainId: "31337",
    networkFingerprint: "local:31337:localhost",
    account: "anvil0",
    deployTxHash: `0x${"2".repeat(64)}`,
    status: "ready",
    constructorArgs: [],
    value: null,
    abiSummary: {
      functions: 2,
      events: 0,
      errors: 0,
      constructor: false,
    },
    constructor: null,
    functions: [],
    createdAtUnix: 1_801_526_410,
  },
];

const twoFunctionSession: DevSession = {
  target: "Counter",
  contract: "Counter",
  sourceMode: "project",
  projectRoot: "/tmp/project",
  sourceFile: "src/Counter.sol",
  sourceFiles: ["src/Counter.sol", "src/Other.sol"],
  sourceTargets: [
    { sourceFile: "src/Counter.sol", contract: "Counter", target: "src/Counter.sol:Counter" },
    { sourceFile: "src/Other.sol", contract: "Other", target: "src/Other.sol:Other" },
  ],
  artifactPath: "/tmp/project/out/Counter.sol/Counter.json",
  abiSummary: {
    functions: 2,
    events: 0,
    errors: 0,
    constructor: false,
  },
  constructor: null,
  functions: [
    {
      name: "number",
      signature: "number()",
      state_mutability: "view",
      kind: "read",
      inputs: [],
      outputs: [{ name: "", kind: "uint256" }],
    },
    {
      name: "setNumber",
      signature: "setNumber(uint256)",
      state_mutability: "nonpayable",
      kind: "write",
      inputs: [{ name: "value", kind: "uint256" }],
      outputs: [],
    },
  ],
};

const userDefinedValueTypeSession: DevSession = {
  target: "Counter",
  contract: "Counter",
  sourceMode: "project",
  projectRoot: "/tmp/project",
  sourceFile: "src/Counter.sol",
  sourceFiles: ["src/Counter.sol"],
  sourceTargets: [{ sourceFile: "src/Counter.sol", contract: "Counter", target: "src/Counter.sol:Counter" }],
  artifactPath: "/tmp/project/out/Counter.sol/Counter.json",
  abiSummary: {
    functions: 3,
    events: 0,
    errors: 0,
    constructor: false,
  },
  constructor: null,
  functions: [
    {
      name: "TimePassed",
      signature: "TimePassed(uint256,uint256)",
      state_mutability: "pure",
      kind: "read",
      inputs: [
        { name: "curr", kind: "uint256" },
        { name: "pass", kind: "uint256" },
      ],
      outputs: [{ name: "", kind: "uint256" }],
    },
    {
      name: "counter",
      signature: "counter()",
      state_mutability: "view",
      kind: "read",
      inputs: [],
      outputs: [{ name: "", kind: "uint256" }],
    },
    {
      name: "count",
      signature: "count()",
      state_mutability: "nonpayable",
      kind: "write",
      inputs: [],
      outputs: [],
    },
  ],
};

const referenceTypeSession: DevSession = {
  target: "Counter",
  contract: "Counter",
  sourceMode: "project",
  projectRoot: "/tmp/project",
  sourceFile: "src/Counter.sol",
  sourceFiles: ["src/Counter.sol"],
  sourceTargets: [{ sourceFile: "src/Counter.sol", contract: "Counter", target: "src/Counter.sol:Counter" }],
  artifactPath: "/tmp/project/out/Counter.sol/Counter.json",
  abiSummary: {
    functions: 2,
    events: 0,
    errors: 0,
    constructor: false,
  },
  constructor: null,
  functions: [
    {
      name: "balances",
      signature: "balances(address)",
      state_mutability: "view",
      kind: "read",
      inputs: [{ name: "", kind: "address" }],
      outputs: [{ name: "", kind: "uint256" }],
    },
    {
      name: "numbers",
      signature: "numbers(uint256)",
      state_mutability: "view",
      kind: "read",
      inputs: [{ name: "", kind: "uint256" }],
      outputs: [{ name: "", kind: "uint256" }],
    },
  ],
};

function deployedForSession(session: DevSession, id = "local:Counter:0x000000000000000000000000000000000000c0fe"): readonly DevDeployedContract[] {
  const first = deployedContracts[0];
  if (first === undefined) {
    throw new Error("missing deployed contract fixture");
  }
  return [{
    ...first,
    id,
    contract: session.contract,
    target: session.target,
    sourceFile: session.sourceFile,
    abiSummary: session.abiSummary,
    constructor: session.constructor,
    functions: session.functions,
  }];
}

const constructorSession: DevSession = {
  target: "Counter",
  contract: "Counter",
  sourceMode: "project",
  projectRoot: "/tmp/project",
  sourceFile: "src/Counter.sol",
  sourceFiles: ["src/Counter.sol"],
  sourceTargets: [{ sourceFile: "src/Counter.sol", contract: "Counter", target: "src/Counter.sol:Counter" }],
  artifactPath: "/tmp/project/out/Counter.sol/Counter.json",
  abiSummary: {
    functions: 0,
    events: 0,
    errors: 0,
    constructor: true,
  },
  constructor: {
    signature: "constructor(uint256)",
    state_mutability: "nonpayable",
    inputs: [{ name: "initial", kind: "uint256" }],
  },
  functions: [],
};

const txPreviewModal = {
  type: "txPreview",
  gasLimitMode: "auto",
  gasLimitText: "",
  event: {
    type: "tx.preview",
    id: "preview-1",
    timestamp: "2026-06-03T00:00:00.000Z",
    action: "send",
    network: {
      name: "local",
      chainId: 31337,
      fingerprint: "local:31337:localhost",
      writePolicy: "local",
    },
    account: {
      name: "anvil0",
      address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    },
    signer: {
      name: "anvil0",
      source: "anvil-index",
      address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      available: true,
    },
    target: {
      display: "src/Counter.sol:Counter",
      contract: "Counter",
      sourceMode: "project",
      sourceFile: "src/Counter.sol",
    },
    calldata: {
      function: "setPair",
      signature: "setPair((uint256,address))",
      args: ["(1,0x000000000000000000000000000000000000c0fe)"],
      hex: "0x1234567890abcdef",
    },
    gas: {
      source: "rpc_estimate",
      estimate: "42123",
      confidence: "medium",
    },
  },
} satisfies DevModal;

const deployThenSendPreviewModal = {
  type: "txPreview",
  gasLimitMode: "auto",
  gasLimitText: "",
  event: {
    ...txPreviewModal.event,
    id: "deploy-preview-1",
    action: "deploy",
    calldata: {
      function: "constructor",
      signature: "constructor()",
      args: [],
      hex: "0x",
    },
    gas: {
      source: "compiler_estimate",
      confidence: "low",
    },
    followup: {
      action: "send",
      calldata: txPreviewModal.event.calldata,
      gas: {
        source: "rpc_estimate",
        confidence: "low",
        context: { note: "estimate_after_deploy" },
      },
    },
  },
} satisfies DevModal;

describe("DevShell", () => {
  test("renders the English shell at 80x24", async () => {
    const setup = await renderShell("en-US");
    const frame = setup.captureCharFrame();
    const spans = setup.captureSpans();

    expect(frame).toContain("Compile & Deploy");
    expect(frame).toContain("State");
    expect(frame).toContain("Feed");
    expect(frame).toContain("Keys");
    expect(spans.lines.length).toBeGreaterThan(0);
  });

  test("renders contract details from a dev session", async () => {
    const session: DevSession = {
      target: "Counter",
      contract: "Counter",
      sourceMode: "project",
      projectRoot: "/tmp/project",
      sourceFile: "src/Counter.sol",
      sourceFiles: ["src/Counter.sol", "src/Other.sol"],
      sourceTargets: [
        { sourceFile: "src/Counter.sol", contract: "Counter", target: "src/Counter.sol:Counter" },
        { sourceFile: "src/Other.sol", contract: "Other", target: "src/Other.sol:Other" },
      ],
      artifactPath: "/tmp/project/out/Counter.sol/Counter.json",
      abiSummary: {
        functions: 1,
        events: 0,
        errors: 0,
        constructor: false,
      },
      constructor: null,
      functions: [
        {
          name: "number",
          signature: "number()",
          state_mutability: "view",
          kind: "read",
          inputs: [],
          outputs: [{ name: "", kind: "uint256" }],
        },
      ],
    };
    const setup = await renderShell("en-US", 80, 24, session, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, deployedForSession(session));

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Counter");
    expect(frame).toContain("number()");
  });

  test("renders per-reader state failures without hiding successful values", async () => {
    const setup = await renderShell(
      "zh-CN",
      104,
      30,
      twoFunctionSession,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        status: {
          status: "ready",
          message: "1/2 reader value(s) loaded; 1 failed.",
          hint: null,
        },
        address: "0x000000000000000000000000000000000000c0fe",
        values: [
          {
            name: "number",
            signature: "number()",
            output_types: ["uint256"],
            readable: "42",
            raw: "42",
          },
          {
            name: "getWinner",
            signature: "getWinner()",
            output_types: ["address", "uint256"],
            readable: null,
            raw: "",
            error: "cast call failed for getWinner().",
          },
        ],
      },
      undefined,
      deployedForSession(twoFunctionSession),
    );

    const frame = setup.captureCharFrame();
    expect(frame).toContain("number");
    expect(frame).toContain("解码值: 42");
    expect(frame).toContain("getWinner");
    expect(frame).toContain("读取失败");
  });

  test("state rows can be selected and opened", async () => {
    const setup = await renderShell(
      "en-US",
      104,
      32,
      twoFunctionSession,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        status: { status: "ready", message: "ready", hint: null },
        address: "0x000000000000000000000000000000000000c0fe",
        values: [],
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
      },
      undefined,
      deployedForSession(twoFunctionSession),
    );

    setup.mockInput.pressTab();
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("State details");
    expect(frame).toContain("balances");
    expect(frame).toContain("3 checked");
    expect(frame).toContain("default values hidden");
  });

  test("state row selection survives an empty refresh frame", async () => {
    const populatedSnapshot = {
      status: { status: "ready", message: "ready", hint: null },
      address: "0x000000000000000000000000000000000000c0fe",
      values: [],
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
          summary: "owner=7",
          detailAvailable: true,
        },
      ],
    } as const satisfies NonNullable<DevShellProps["stateSnapshot"]>;
    const emptySnapshot = {
      ...populatedSnapshot,
      values: [],
      storageValues: [],
    } as const satisfies NonNullable<DevShellProps["stateSnapshot"]>;
    const [stateSnapshot, setStateSnapshot] = createSignal<NonNullable<DevShellProps["stateSnapshot"]>>(populatedSnapshot);
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          session={twoFunctionSession}
          deployedContracts={deployedForSession(twoFunctionSession)}
          stateSnapshot={stateSnapshot()}
        />
      ),
      {
        width: 104,
        height: 32,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressTab();
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("> balances");

    setStateSnapshot(emptySnapshot);
    await setup.renderOnce();
    setStateSnapshot(populatedSnapshot);
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("> balances");
  });

  test("State panel display mode shortcut only toggles the local State panel display", async () => {
    const changes: DevSettingsChange[] = [];
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          session={twoFunctionSession}
          deployedContracts={deployedForSession(twoFunctionSession)}
          settings={{
            language: "system",
            resolvedLocale: "en-US",
            systemLocale: "en-US",
            showRawStateValues: true,
            hideNoArgReadActions: false,
          }}
          stateSnapshot={{
            status: {
              status: "ready",
              message: "ready",
              hint: null,
            },
            address: "0x000000000000000000000000000000000000c0fe",
            values: [
              {
                name: "number",
                signature: "number()",
                output_types: ["uint256"],
                readable: "42",
                raw: "0x000000000000000000000000000000000000000000000000000000000000002a",
              },
            ],
          }}
          onSettingsChange={(change) => {
            changes.push(change);
          }}
        />
      ),
      {
        width: 104,
        height: 30,
        useMouse: true,
      },
    );
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("raw:");
    expect(setup.captureCharFrame()).toContain("signature: number()");
    setup.mockInput.pressTab();
    await setup.renderOnce();
    setup.mockInput.pressKey("o", { ctrl: true });
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("raw:");
    expect(setup.captureCharFrame()).toContain("signature: number()");

    setup.mockInput.pressKey("o");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("decoded: 42");
    expect(frame).not.toContain("raw:");
    expect(frame).not.toContain("signature: number()");
    expect(frame).toContain("o compact/detail");
    expect(changes).toEqual([]);
  });

  test("renders contract tabs for a direct single-file session whose target uses the original path", async () => {
    const actions: DevAction[] = [];
    const session: DevSession = {
      target: "/tmp/original/FeatureDemo.sol:ConSolFeatureDemo",
      contract: "ConSolFeatureDemo",
      sourceMode: "single_file",
      projectRoot: "/tmp/scratch",
      sourceFile: "src/FeatureDemo.sol",
      sourceFiles: ["src/FeatureDemo.sol"],
      sourceTargets: [
        { sourceFile: "src/FeatureDemo.sol", contract: "IDemo", target: "src/FeatureDemo.sol:IDemo", deployable: false },
        { sourceFile: "src/FeatureDemo.sol", contract: "BaseDemo", target: "src/FeatureDemo.sol:BaseDemo", deployable: false },
        { sourceFile: "src/FeatureDemo.sol", contract: "ConSolFeatureDemo", target: "src/FeatureDemo.sol:ConSolFeatureDemo", deployable: true },
        { sourceFile: "src/FeatureDemo.sol", contract: "ExtraDemo", target: "src/FeatureDemo.sol:ExtraDemo", deployable: true },
      ],
      artifactPath: "/tmp/scratch/out/FeatureDemo.sol/ConSolFeatureDemo.json",
      abiSummary: {
        functions: 1,
        events: 0,
        errors: 0,
        constructor: false,
      },
      constructor: null,
      functions: [
        {
          name: "summary",
          signature: "summary()",
          state_mutability: "view",
          kind: "read",
          inputs: [],
          outputs: [{ name: "", kind: "uint256" }],
        },
      ],
      deployable: true,
    };
    const setup = await renderShell(
      "en-US",
      104,
      30,
      session,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (action) => {
        actions.push(action);
      },
    );

    const frame = setup.captureCharFrame();
    expect(frame).toContain("2 non-deployable declarations");
    expect(frame).not.toContain("IDemo");
    expect(frame).not.toContain("BaseDemo");
    expect(frame).toContain("ConSolFeatureDemo");
    expect(frame).toContain("ExtraDemo");

    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    await setup.flush();

    const selectedTargets = actions.flatMap((action) => action.type === "selectSourceTarget" ? [action.target] : []);
    expect(selectedTargets).not.toContain("src/FeatureDemo.sol:IDemo");
    expect(selectedTargets).not.toContain("src/FeatureDemo.sol:BaseDemo");
  });

  test("renders contract tabs for a directory-picked single-file session", async () => {
    const setup = await renderShell("en-US", 104, 30, {
      target: "FeatureDemo.sol:ConSolFeatureDemo",
      contract: "ConSolFeatureDemo",
      sourceMode: "single_file",
      projectRoot: "/tmp/scratch",
      sourceFile: "src/FeatureDemo.sol",
      sourceFiles: ["FeatureDemo.sol"],
      sourceTargets: [
        { sourceFile: "FeatureDemo.sol", contract: "IDemo", target: "FeatureDemo.sol:IDemo", deployable: false },
        { sourceFile: "FeatureDemo.sol", contract: "BaseDemo", target: "FeatureDemo.sol:BaseDemo", deployable: false },
        { sourceFile: "FeatureDemo.sol", contract: "ConSolFeatureDemo", target: "FeatureDemo.sol:ConSolFeatureDemo", deployable: true },
        { sourceFile: "FeatureDemo.sol", contract: "ExtraDemo", target: "FeatureDemo.sol:ExtraDemo", deployable: true },
      ],
      artifactPath: "/tmp/scratch/out/FeatureDemo.sol/ConSolFeatureDemo.json",
      abiSummary: {
        functions: 1,
        events: 0,
        errors: 0,
        constructor: false,
      },
      constructor: null,
      functions: [
        {
          name: "summary",
          signature: "summary()",
          state_mutability: "view",
          kind: "read",
          inputs: [],
          outputs: [{ name: "", kind: "uint256" }],
        },
      ],
      deployable: true,
    });

    const frame = setup.captureCharFrame();
    expect(frame).toContain("2 non-deployable declarations");
    expect(frame).not.toContain("IDemo");
    expect(frame).not.toContain("BaseDemo");
    expect(frame).toContain("ConSolFeatureDemo");
    expect(frame).toContain("ExtraDemo");
  });

  test("contract workspace groups read write and payable functions", async () => {
    const session: DevSession = {
      ...twoFunctionSession,
      functions: [
        {
          name: "number",
          signature: "number()",
          state_mutability: "view",
          kind: "read",
          inputs: [],
          outputs: [{ name: "", kind: "uint256" }],
        },
        {
          name: "setNumber",
          signature: "setNumber(uint256)",
          state_mutability: "nonpayable",
          kind: "write",
          inputs: [{ name: "value", kind: "uint256" }],
          outputs: [],
        },
        {
          name: "buy",
          signature: "buy()",
          state_mutability: "payable",
          kind: "payable",
          inputs: [],
          outputs: [],
        },
      ],
    };
    const setup = await renderShell("en-US", 104, 34, session, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, deployedForSession(session));

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Read");
    expect(frame).toContain("Write");
    expect(frame).toContain("Payable");
    expect(frame).toContain("number()");
    expect(frame).toContain("setNumber(uint256)");
    expect(frame).toContain("buy()");
  });

  test("contract actions include pure functions with user-defined value type parameters", async () => {
    const actions: DevAction[] = [];
    const setup = await renderShell(
      "en-US",
      104,
      32,
      userDefinedValueTypeSession,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (action) => {
        actions.push(action);
      },
      undefined,
      undefined,
      undefined,
      undefined,
      deployedForSession(userDefinedValueTypeSession),
    );

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Read");
    expect(frame).toContain("[READ] TimePassed(uint256,uint256)");
    expect(frame).toContain("[WRITE] count()");

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(actions.at(-1)).toMatchObject({
      type: "openFunctionInput",
      action: "read",
      function: {
        name: "TimePassed",
        signature: "TimePassed(uint256,uint256)",
      },
    });
  });

  test("contract actions include public array and mapping getters", async () => {
    const setup = await renderShell(
      "en-US",
      104,
      24,
      referenceTypeSession,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      deployedForSession(referenceTypeSession),
    );

    const frame = setup.captureCharFrame();
    expect(frame).toContain("[READ] balances(address)");
    expect(frame).toContain("[READ] numbers(uint256)");
  });

  test("state panel shows storage rows when only reference type getters exist", async () => {
    const setup = await renderShell(
      "en-US",
      104,
      28,
      referenceTypeSession,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        status: { status: "ready", message: "ready", hint: null },
        address: "0x000000000000000000000000000000000000c0fe",
        values: [],
        storageValues: [
          {
            id: "storage:numbers",
            kind: "array",
            name: "numbers",
            typeLabel: "uint256[]",
            summary: "len=2 [1, 2]",
            detailAvailable: false,
          },
          {
            id: "storage:balances",
            kind: "mapping",
            name: "balances",
            typeLabel: "mapping(address => uint256)",
            summary: "no compatible keys",
            detailAvailable: true,
            checked: 0,
            nonDefault: 0,
          },
        ],
      },
      undefined,
      deployedForSession(referenceTypeSession),
    );

    const frame = setup.captureCharFrame();
    expect(frame).toContain("numbers (uint256[])");
    expect(frame).toContain("balances (mapping(address => uint256))");
  });

  test("g toggles hiding no-argument read actions without hiding parameterized reads or writes", async () => {
    const actions: DevAction[] = [];
    const changes: DevSettingsChange[] = [];
    const setup = await testRender(
      () => {
        const [settings, setSettings] = createSignal<DevSettingsSnapshot>({
          language: "system",
          resolvedLocale: "en-US",
          systemLocale: "en-US",
          showRawStateValues: true,
          hideNoArgReadActions: false,
        });
        return (
          <DevShell
            locale="en-US"
            session={userDefinedValueTypeSession}
            deployedContracts={deployedForSession(userDefinedValueTypeSession)}
            settings={settings()}
            onDevAction={(action) => {
              actions.push(action);
            }}
            onSettingsChange={(change) => {
              changes.push(change);
              const next = {
                ...settings(),
                ...change,
              };
              setSettings(next);
              return next;
            }}
          />
        );
      },
      {
        width: 104,
        height: 32,
        useMouse: true,
      },
    );
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("[READ] TimePassed(uint256,uint256)");
    expect(setup.captureCharFrame()).toContain("[READ] counter()");
    expect(setup.captureCharFrame()).toContain("[WRITE] count()");

    setup.mockInput.pressKey("g");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("[READ] TimePassed(uint256,uint256)");
    expect(frame).not.toContain("[READ] counter()");
    expect(frame).toContain("[WRITE] count()");
    expect(changes).toEqual([{ hideNoArgReadActions: true }]);

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(actions.at(-1)).toMatchObject({
      type: "openFunctionInput",
      action: "read",
      function: {
        name: "TimePassed",
        signature: "TimePassed(uint256,uint256)",
      },
    });
  });

  test("keyboard navigation scrolls long contract action lists to the selected function", async () => {
    const functions = [
      ...Array.from({ length: 16 }, (_, index) => {
        const name = `reader${String(index + 1).padStart(2, "0")}`;
        return {
          name,
          signature: `${name}()`,
          state_mutability: "view",
          kind: "read" as const,
          inputs: [],
          outputs: [{ name: "", kind: "uint256" }],
        };
      }),
      {
        name: "update",
        signature: "update()",
        state_mutability: "nonpayable",
        kind: "write" as const,
        inputs: [],
        outputs: [],
      },
    ];
    const session: DevSession = {
      ...twoFunctionSession,
      abiSummary: {
        functions: functions.length,
        events: 0,
        errors: 0,
        constructor: false,
      },
      functions,
    };
    const setup = await renderShell("en-US", 104, 24, session, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, deployedForSession(session));

    for (let index = 0; index < functions.length - 1; index += 1) {
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
    }
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("> [WRITE] update()");
  });

  test("mouse wheel scrolling keeps the last contract action title visible in short panels", async () => {
    const functions = [
      ...Array.from({ length: 16 }, (_, index) => {
        const name = `reader${String(index + 1).padStart(2, "0")}`;
        return {
          name,
          signature: `${name}()`,
          state_mutability: "view",
          kind: "read" as const,
          inputs: [],
          outputs: [{ name: "", kind: "uint256" }],
        };
      }),
      {
        name: "update",
        signature: "update()",
        state_mutability: "nonpayable",
        kind: "write" as const,
        inputs: [],
        outputs: [],
      },
    ];
    const session: DevSession = {
      ...twoFunctionSession,
      abiSummary: {
        functions: functions.length,
        events: 0,
        errors: 0,
        constructor: false,
      },
      functions,
    };
    const setup = await renderShell("en-US", 104, 24, session, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, deployedForSession(session));

    for (let index = 0; index < 40; index += 1) {
      await setup.mockMouse.scroll(20, 19, "down");
      await setup.renderOnce();
    }
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("[WRITE] update()");
  });

  test("Enter does not submit contract functions until a deployed contract is selected", async () => {
    const actions: DevAction[] = [];
    const setup = await renderShell(
      "en-US",
      104,
      26,
      twoFunctionSession,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (action) => {
        actions.push(action);
      },
    );

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(actions).toEqual([]);
    expect(setup.captureCharFrame()).toContain("no deployed contract selected");
  });

  test("Enter directly submits a no-arg read function for the selected deployed contract", async () => {
    const actions: DevAction[] = [];
    const setup = await renderShell(
      "en-US",
      104,
      26,
      twoFunctionSession,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (action) => {
        actions.push(action);
      },
      undefined,
      undefined,
      undefined,
      undefined,
      deployedForSession(twoFunctionSession),
    );

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(actions.at(-1)).toMatchObject({
      type: "submitFunction",
      action: "read",
      addressOverride: "0x000000000000000000000000000000000000c0fe",
    });
  });

  test("Enter opens args input for read functions with inputs", async () => {
    const actions: DevAction[] = [];
    const session: DevSession = {
      ...twoFunctionSession,
      functions: [
        {
          name: "balanceOf",
          signature: "balanceOf(address)",
          state_mutability: "view",
          kind: "read",
          inputs: [{ name: "owner", kind: "address" }],
          outputs: [{ name: "", kind: "uint256" }],
        },
      ],
    };
    const setup = await renderShell(
      "en-US",
      104,
      26,
      session,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (action) => {
        actions.push(action);
      },
      undefined,
      undefined,
      undefined,
      undefined,
      deployedForSession(session),
    );

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(actions.at(-1)).toMatchObject({ type: "openFunctionInput", action: "read" });
  });

  test("source picker groups multiple contract targets from one Solidity source file", async () => {
    const setup = await renderShell("en-US", 104, 26, {
      ...twoFunctionSession,
      sourceFiles: ["src/Counter.sol", "src/Multi.sol"],
      sourceTargets: [
        { sourceFile: "src/Counter.sol", contract: "Counter", target: "src/Counter.sol:Counter" },
        { sourceFile: "src/Multi.sol", contract: "Alpha", target: "src/Multi.sol:Alpha" },
        { sourceFile: "src/Multi.sol", contract: "Beta", target: "src/Multi.sol:Beta" },
      ],
    });

    setup.mockInput.pressKey("f");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();

    expect(frame).toContain("File picker");
    expect(frame).toContain("src/Multi.sol");
    expect(frame).toContain("2 contracts");
  });

  test("Enter activates the selected source target from the file picker", async () => {
    const actions: DevAction[] = [];
    const setup = await renderShell(
      "en-US",
      92,
      30,
      twoFunctionSession,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (action) => {
        actions.push(action);
      },
      undefined,
      undefined,
      undefined,
      undefined,
      deployedForSession(twoFunctionSession),
    );

    setup.mockInput.pressKey("f");
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(actions.at(-1)).toEqual({
      type: "selectSourceTarget",
      sourceFile: "src/Other.sol",
      target: "src/Other.sol:Other",
    });
  });

  test("renders the Chinese shell at 80x24", async () => {
    const setup = await renderShell("zh-CN");
    const frame = setup.captureCharFrame();

    expect(frame).toContain("编译和部署");
    expect(frame).toContain("状态");
    expect(frame).toContain("动态");
  });

  test("Tab moves focus through panels", async () => {
    const setup = await renderShell("en-US");

    setup.mockInput.pressTab();
    await setup.renderOnce();
    await setup.flush();

    expect(statusLine(setup.captureCharFrame())).not.toContain("focus:");
  });

  test("mouse click focuses the state panel", async () => {
    const setup = await renderShell("en-US");

    expect(statusLine(setup.captureCharFrame())).not.toContain("focus:");

    await setup.mockMouse.click(50, 5);
    await setup.renderOnce();
    await setup.flush();

    expect(statusLine(setup.captureCharFrame())).not.toContain("focus:");
  });

  test("keyboard navigation scrolls long source target lists in the file picker", async () => {
    const sourceTargets = Array.from({ length: 24 }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      return {
        sourceFile: `src/C${number}.sol`,
        contract: `C${number}`,
        target: `src/C${number}.sol:C${number}`,
      };
    });
    const setup = await renderShell("en-US", 92, 18, {
      ...twoFunctionSession,
      sourceFile: "src/C01.sol",
      sourceFiles: sourceTargets.map((target) => target.sourceFile),
      sourceTargets,
      target: "src/C01.sol:C01",
      contract: "C01",
    });

    setup.mockInput.pressKey("f");
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("src/C01.sol");

    for (let index = 0; index < 15; index += 1) {
      setup.mockInput.pressArrow("down");
      await setup.renderOnce();
    }
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("src/C16.sol");
    expect(frame).not.toContain("src/C01.sol");
  });

  test("f opens a fuzzy source file picker scoped to the active session", async () => {
    const actions: DevAction[] = [];
    const setup = await renderShell(
      "en-US",
      104,
      26,
      {
        ...twoFunctionSession,
        sourceFiles: ["src/Counter.sol", "src/Multi.sol"],
        sourceTargets: [
          { sourceFile: "src/Counter.sol", contract: "Counter", target: "src/Counter.sol:Counter" },
          { sourceFile: "src/Multi.sol", contract: "Alpha", target: "src/Multi.sol:Alpha" },
          { sourceFile: "src/Multi.sol", contract: "Beta", target: "src/Multi.sol:Beta" },
        ],
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (action) => {
        actions.push(action);
      },
    );

    setup.mockInput.pressKey("f");
    await setup.renderOnce();
    await setup.mockInput.typeText("msb");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("File picker");
    expect(frame).toContain("src/Multi.sol");
    expect(frame).toContain("2 contracts");

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(actions.at(-1)).toEqual({
      type: "selectSourceTarget",
      sourceFile: "src/Multi.sol",
      target: "src/Multi.sol:Beta",
    });
  });

  test("/ does not open the primary fuzzy file picker", async () => {
    const setup = await renderShell("en-US", 104, 26, {
      ...twoFunctionSession,
      sourceTargets: [
        { sourceFile: "src/Counter.sol", contract: "Counter", target: "src/Counter.sol:Counter" },
        { sourceFile: "src/Multi.sol", contract: "Beta", target: "src/Multi.sol:Beta" },
      ],
    });

    setup.mockInput.pressKey("/");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).not.toContain("File picker");
    expect(frame).not.toContain("search files or contracts");
  });

  test("shortcut bar labels f as file picker and shows bracket tab keys explicitly", async () => {
    const setup = await renderShell("en-US", 104, 26, twoFunctionSession);

    const frame = setup.captureCharFrame();
    expect(frame).toContain("f choose file");
    expect(frame).toContain("[ / ]");
    expect(frame).not.toContain("/ choose file");
    expect(frame).not.toContain("/ contract");
    expect(frame).not.toContain("[ ] tabs");
  });

  test("q opens an exit confirmation and q again confirms exit", async () => {
    let exits = 0;
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          session={twoFunctionSession}
          onExitRequest={() => {
            exits += 1;
          }}
        />
      ),
      {
        width: 104,
        height: 26,
        useMouse: true,
      },
    );

    await setup.flush();
    setup.mockInput.pressEscape();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    expect(exits).toBe(0);
    expect(setup.captureCharFrame()).not.toContain("Confirm quit");

    setup.mockInput.pressKey("q");
    await setup.renderOnce();
    await setup.flush();

    expect(exits).toBe(0);
    expect(setup.captureCharFrame()).toContain("Confirm quit");
    expect(setup.captureCharFrame()).toContain("Press q again to quit ConSol.");

    setup.mockInput.pressEscape();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    expect(exits).toBe(0);
    expect(setup.captureCharFrame()).not.toContain("Confirm quit");

    setup.mockInput.pressKey("q");
    await setup.renderOnce();
    setup.mockInput.pressKey("q");
    await setup.renderOnce();
    await setup.flush();

    expect(exits).toBe(1);
  });

  test("q opens exit confirmation from the shortcuts overlay", async () => {
    let exits = 0;
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          session={twoFunctionSession}
          onExitRequest={() => {
            exits += 1;
          }}
        />
      ),
      {
        width: 104,
        height: 26,
        useMouse: true,
      },
    );

    await setup.flush();
    setup.mockInput.pressKey("?");
    await setup.renderOnce();
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("q  quit");

    setup.mockInput.pressKey("q");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(exits).toBe(0);
    expect(frame).toContain("Confirm quit");
    expect(frame).not.toContain("q  quit");
  });

  test("only plain q is treated as an exit confirmation key", () => {
    expect(isExitConfirmKey({ name: "q", sequence: "q" })).toBe(true);
    expect(isExitConfirmKey({ name: "c", sequence: "\u0003", ctrl: true })).toBe(false);
    expect(isExitConfirmKey({ name: "escape", sequence: "\u001B" })).toBe(false);
    expect(isExitConfirmKey({ name: "q", sequence: "q", meta: true })).toBe(false);
  });

  test("entry picker supports fuzzy search before a dev session is selected", async () => {
    const selected: string[] = [];
    const setup = await renderShell(
      "en-US",
      104,
      26,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [
        {
          name: "counter",
          label: "ClickCounter",
          active: false,
          badge: "CONTRACT",
          meta: "courses/solidity-30days/contracts/day-01-ClickCounter.sol",
          description: "courses/solidity-30days/contracts/day-01-ClickCounter.sol:ClickCounter",
          searchText: "day-01-ClickCounter.sol ClickCounter",
        },
        {
          name: "dex",
          label: "MiniDexFactory",
          active: false,
          badge: "CONTRACT",
          meta: "courses/solidity-30days/contracts/day-30-MiniDexFactory.sol",
          description: "courses/solidity-30days/contracts/day-30-MiniDexFactory.sol:MiniDexFactory",
          searchText: "day-30-MiniDexFactory.sol MiniDexFactory",
        },
      ],
      (option) => {
        selected.push(option.name);
      },
    );

    await setup.mockInput.typeText("d1cc");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("File picker");
    expect(frame).toContain("[CONTRACT] ClickCounter");
    expect(frame).toContain("day-01-ClickCounter.sol");

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(selected).toEqual(["counter"]);
  });

  test("f reopens the entry picker before a dev session is selected", async () => {
    const setup = await renderShell(
      "en-US",
      104,
      26,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [
        {
          name: "counter",
          label: "ClickCounter",
          active: false,
          badge: "CONTRACT",
          meta: "courses/solidity-30days/contracts/day-01-ClickCounter.sol",
          description: "courses/solidity-30days/contracts/day-01-ClickCounter.sol:ClickCounter",
          searchText: "day-01-ClickCounter.sol ClickCounter",
        },
        {
          name: "dex",
          label: "MiniDexFactory",
          active: false,
          badge: "CONTRACT",
          meta: "courses/solidity-30days/contracts/day-30-MiniDexFactory.sol",
          description: "courses/solidity-30days/contracts/day-30-MiniDexFactory.sol:MiniDexFactory",
          searchText: "day-30-MiniDexFactory.sol MiniDexFactory",
        },
      ],
    );

    expect(setup.captureCharFrame()).toContain("[CONTRACT] ClickCounter");

    setup.mockInput.pressEscape();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("[CONTRACT] ClickCounter");

    setup.mockInput.pressKey("f");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("File picker");
    expect(frame).toContain("[CONTRACT] ClickCounter");
  });

  test("mouse click selects a contract function and a second click opens input", async () => {
    const actions: DevAction[] = [];
    const setup = await renderShell(
      "en-US",
      92,
      26,
      twoFunctionSession,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (action) => {
        actions.push(action);
      },
      undefined,
      undefined,
      undefined,
      undefined,
      deployedForSession(twoFunctionSession),
    );

    await setup.mockMouse.click(10, 21);
    await setup.renderOnce();
    await setup.flush();
    expect(actions).toEqual([]);

    await setup.mockMouse.click(10, 21);
    await setup.renderOnce();
    await setup.flush();

    const selectedFunction = twoFunctionSession.functions[1];
    if (selectedFunction === undefined) {
      throw new Error("missing second function");
    }

    expect(actions.at(-1)).toMatchObject({
      type: "openFunctionInput",
      action: "send",
      function: selectedFunction,
    });
  });

  test("d opens constructor deploy input", async () => {
    const actions: DevAction[] = [];
    const setup = await renderShell(
      "en-US",
      92,
      26,
      constructorSession,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (action) => {
        actions.push(action);
      },
    );

    expect(setup.captureCharFrame()).toContain("constructor: constructor(uint256)");

    setup.mockInput.pressKey("d");
    await setup.renderOnce();
    await setup.flush();

    expect(actions.at(-1)).toMatchObject({
      type: "openFunctionInput",
      action: "deploy",
      function: {
        name: "constructor",
        signature: "constructor(uint256)",
        state_mutability: "nonpayable",
        kind: "write",
        inputs: [{ name: "initial", kind: "uint256" }],
        outputs: [],
      },
    });
  });

  test("D no longer submits redeploy for the active contract", async () => {
    const actions: DevAction[] = [];
    const setup = await renderShell(
      "en-US",
      104,
      26,
      twoFunctionSession,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (action) => {
        actions.push(action);
      },
      undefined,
      undefined,
      {
        status: { status: "ready", message: null, hint: null },
        address: "0x000000000000000000000000000000000000c0fe",
        values: [],
      },
    );

    setup.mockInput.pressKey("D");
    await setup.renderOnce();
    await setup.flush();

    expect(actions).toEqual([]);
  });

  test("Enter on a deployed contract function preserves the deployed workspace", async () => {
    const actions: DevAction[] = [];
    const deployedWithWorkspace = [
      {
        ...deployedContracts[0],
        functions: twoFunctionSession.functions,
        workspaceRoot: "/tmp/original-project",
      },
    ] as unknown as readonly DevDeployedContract[];
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          session={twoFunctionSession}
          deployedContracts={deployedWithWorkspace}
          onDevAction={(action) => {
            actions.push(action);
          }}
        />
      ),
      {
        width: 104,
        height: 28,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(actions.at(-1)).toMatchObject({
      type: "submitFunction",
      action: "read",
      targetOverride: "src/Counter.sol:Counter",
      contractOverride: "Counter",
      addressOverride: "0x000000000000000000000000000000000000c0fe",
      cwdOverride: "/tmp/original-project",
    });
  });

  test("preferred deployed contract selection targets the newly deployed instance", async () => {
    const actions: DevAction[] = [];
    const first = deployedForSession(twoFunctionSession, "deployed:first")[0];
    if (first === undefined) {
      throw new Error("missing deployed fixture");
    }
    const second = {
      ...first,
      id: "deployed:second",
      address: "0x000000000000000000000000000000000000dEaD",
    };
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          session={twoFunctionSession}
          deployedContracts={[first, second]}
          preferredActiveDeployedContractId="deployed:second"
          onDevAction={(action) => {
            actions.push(action);
          }}
        />
      ),
      {
        width: 104,
        height: 28,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(actions.at(-1)).toMatchObject({
      type: "submitFunction",
      action: "read",
      addressOverride: "0x000000000000000000000000000000000000dEaD",
    });
  });

  test("mouse wheel updates feed scroll state", async () => {
    const setup = await renderShell("en-US");

    await setup.mockMouse.scroll(70, 19, "down");
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).toMatch(/scroll:.*1/);
  });

  test("status line shows useful network and account details without focus text", async () => {
    const setup = await renderShell("en-US", 100, 24, undefined, detailedNetworkOptions, undefined, detailedAccountOptions);

    const frame = setup.captureCharFrame();
    expect(frame).toContain("network [local](#31337){anvil/local/rpc: localhost}");
    expect(frame).toContain("account [anvil0](0xf39f..66){anvil}");
    expect(frame).not.toContain("focus:");
  });

  test("top status keeps long network and account details visible by soft-wrapping", async () => {
    const setup = await renderShell(
      "en-US",
      54,
      28,
      undefined,
      [
        {
          name: "long-local",
          label: "long local development network #31337 / rpc health wrapped marker",
          active: true,
        },
      ],
      undefined,
      [
        {
          name: "long-account",
          label: "long-account / 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 / signer alpha wrapped account marker",
          active: true,
        },
      ],
    );

    const frame = setup.captureCharFrame();
    expect(frame).toContain("rpc health wrapped marker");
    expect(frame).toContain("signer alpha");
    expect(frame).toContain("wrapped account marker");
    expect(frame).toContain("rpc health wrapped marker}");
    expect(frame).toContain("wrapped account marker}");
  });

  test("a opens the account selector floating window", async () => {
    const setup = await renderShell("en-US", 80, 24, undefined, undefined, undefined, accountOptions);

    setup.mockInput.pressKey("a");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Account selector");
    expect(frame).toContain("anvil0 / anvil-index");
    expect(frame).toContain("deployer / env-private-key");
    expect(frame).toContain("Dev");
  });

  test("a opens the account selector without seeding the opener key into search", async () => {
    const setup = await renderShell("en-US", 80, 24, undefined, undefined, undefined, [
      { name: "runner", label: "runner / keystore", active: true },
      { name: "deployer", label: "deployer / env-private-key", active: false },
    ]);

    setup.mockInput.pressKey("a");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("runner / keystore");
    expect(frame).toContain("deployer / env-private-key");
  });

  test("account selector shows short addresses and balances without full addresses", async () => {
    const firstAddress = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
    const secondAddress = "0x000000000000000000000000000000000000c0fe";
    const accountStatus: DevAccountStatusSnapshot = {
      networkName: "local",
      accountName: "anvil0",
      address: firstAddress,
      signer: "anvil-index",
      balanceWei: "1000000000000000000",
      balanceDisplay: "1.0000 ETH",
      status: "ok",
      message: null,
      accounts: [
        {
          accountName: "anvil0",
          address: firstAddress,
          signer: "anvil-index",
          balanceWei: "1000000000000000000",
          balanceDisplay: "1.0000 ETH",
          status: "ok",
          message: null,
        },
        {
          accountName: "deployer",
          address: secondAddress,
          signer: "env-private-key",
          balanceWei: "2500000000000000000",
          balanceDisplay: "2.5000 ETH",
          status: "ok",
          message: null,
        },
      ],
    };
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          accountOptions={[
            { name: "anvil0", label: `anvil0 / ${firstAddress} / anvil-index`, active: true },
            { name: "deployer", label: `deployer / ${secondAddress} / env-private-key`, active: false },
          ]}
          accountStatus={accountStatus}
        />
      ),
      {
        width: 132,
        height: 28,
        useMouse: true,
      },
    );
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("1.0000 ETH (1000000000.0000 gwei)");

    setup.mockInput.pressKey("a");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("anvil0");
    expect(frame).toContain("0xf39fd6...b92266");
    expect(frame).toContain("1.0000 ETH");
    expect(frame).toContain("deployer");
    expect(frame).toContain("0x000000...00c0fe");
    expect(frame).toContain("2.5000 ETH");
    expect(frame).not.toContain("1.0000 ETH ·");
    expect(frame).not.toContain("1000000000000000000 wei");
    expect(frame).not.toContain("2.5000 ETH ·");
    expect(frame).not.toContain("2500000000000000000 wei");
    expect(frame).not.toContain(firstAddress);
    expect(frame).not.toContain(secondAddress);
  });

  test("account selector updates the active account with arrow and Enter", async () => {
    const localActiveAccountOptions = [
      { name: "anvil0", label: "anvil0 / anvil-index", active: true },
      { name: "deployer", label: "deployer / env-private-key", active: false },
    ] as const;
    const setup = await renderShell("en-US", 80, 24, undefined, undefined, undefined, localActiveAccountOptions);

    setup.mockInput.pressKey("a");
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("account [deployer] {env-key}");
    expect(frame).not.toContain("Account selector");
  });

  test("account selector filters accounts through input", async () => {
    const setup = await renderShell("en-US", 80, 24, undefined, undefined, undefined, accountOptions);

    setup.mockInput.pressKey("a");
    await setup.renderOnce();
    await setup.mockInput.typeText("dep");
    await setup.renderOnce();
    await setup.flush();

    const filteredFrame = setup.captureCharFrame();
    expect(filteredFrame).toContain("dep");
    expect(filteredFrame).toContain("deployer / env-private-key");
    expect(filteredFrame).not.toContain("anvil0 / anvil-index");

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("account [deployer] {env-key}");
  });

  test("account selector supports mouse selection", async () => {
    const localActiveAccountOptions = [
      { name: "anvil0", label: "anvil0 / anvil-index", active: true },
      { name: "deployer", label: "deployer / env-private-key", active: false },
    ] as const;
    const setup = await renderShell("en-US", 80, 24, undefined, undefined, undefined, localActiveAccountOptions);

    setup.mockInput.pressKey("a");
    await setup.renderOnce();
    await setup.flush();
    await setup.mockMouse.click(31, 14);
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("account [deployer] {env-key}");
  });

  test("feed entries stay pinned to the latest activity", async () => {
    const feedEntries = Array.from({ length: 18 }, (_, index) => `event ${String(index + 1).padStart(2, "0")}`);
    const setup = await renderShell("en-US", 80, 24, undefined, undefined, feedEntries);

    const frame = setup.captureCharFrame();
    expect(frame).toContain("event 18");
    expect(frame).not.toContain("event 01");
  });

  test("narrow width keeps dev panes available as secondary tabs", async () => {
    const setup = await renderShell("zh-CN", 60, 20);

    const frame = setup.captureCharFrame();
    expect(frame).toContain("编译和部署");
    expect(frame).toContain("状态");
    expect(frame).toContain("动态");
    const tabLine = frame.split("\n").find((line) => line.includes("编译和部署") && line.includes("状态") && line.includes("动态")) ?? "";
    expect(tabLine).toContain("╭");
    expect(tabLine).toContain("编译和部署 / 状态 / 动态");
    expect(tabLine).toContain("Tab 切换");
    expect(tabLine).not.toContain("合约");
    expect(tabLine).not.toContain("|");
  });

  test("narrow Dev tabs sit directly above the active panel", async () => {
    const setup = await renderShell("zh-CN", 60, 30);

    const lines = setup.captureCharFrame().split("\n");
    const tabIndex = lines.findIndex((line) => line.includes("编译和部署") && line.includes("状态") && line.includes("动态"));

    expect(tabIndex).toBeGreaterThan(-1);
    expect(lines[tabIndex]).toContain("╭");
    expect(lines[tabIndex]).toContain("编译和部署 / 状态 / 动态");
    expect(lines[tabIndex]).toContain("Tab 切换");
    expect(lines[tabIndex]).not.toContain("|");
    expect(lines[tabIndex + 1]).not.toContain("╭─编译和部署");
  });

  test("narrow width switches Dev panes with Tab while wide width keeps side panels", async () => {
    const stateSnapshot = {
      status: { status: "ready", message: "ready", hint: null },
      address: "0x000000000000000000000000000000000000c0fe",
      values: [
        {
          name: "number",
          signature: "number()",
          output_types: ["uint256"],
          readable: "42",
          raw: "42",
        },
      ],
    } as const satisfies NonNullable<DevShellProps["stateSnapshot"]>;

    const setup = await renderShell(
      "en-US",
      42,
      24,
      twoFunctionSession,
      undefined,
      ["deployed", "read number", "set number"],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      stateSnapshot,
      undefined,
      deployedForSession(twoFunctionSession),
    );

    let frame = setup.captureCharFrame();
    expect(frame).toContain("Compile & Deploy");
    expect(frame).not.toContain("Contract");
    expect(frame).toContain("State");
    expect(frame).toContain("Feed");
    expect(frame).not.toContain("read number");

    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    await setup.flush();

    frame = setup.captureCharFrame();
    expect(frame).toContain("setNumber(uint256)");

    setup.mockInput.pressTab();
    await setup.renderOnce();
    await setup.flush();

    frame = setup.captureCharFrame();
    expect(frame).toContain("State");
    expect(frame).toContain("number");
    expect(frame).not.toContain("setNumber(uint256)");

    setup.mockInput.pressTab();
    await setup.renderOnce();
    await setup.flush();

    frame = setup.captureCharFrame();
    expect(frame).toContain("Feed");
    expect(frame).toContain("set number");
    expect(frame).not.toContain("setNumber(uint256)");

    const wideSetup = await renderShell(
      "en-US",
      104,
      28,
      twoFunctionSession,
      undefined,
      ["deployed", "read number", "set number"],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      stateSnapshot,
      undefined,
      deployedForSession(twoFunctionSession),
    );

    frame = wideSetup.captureCharFrame();
    expect(frame).toContain("Compile & Deploy");
    expect(frame).toContain("State");
    expect(frame).toContain("Feed");
    expect(frame).toContain("set number");
  });

  test("Dev pane layout follows terminal resize without duplicated secondary tabs", async () => {
    const setup = await renderShell("en-US", 42, 24, twoFunctionSession);

    let frame = setup.captureCharFrame();
    expect(frame).toContain("Compile & Deploy");
    expect(frame).toContain("State");
    expect(frame).toContain("Feed");

    setup.resize(104, 28);
    await setup.renderOnce();
    await setup.flush();

    frame = setup.captureCharFrame();
    expect(frame).toContain("Compile & Deploy");
    expect(frame).not.toContain("Contract");

    setup.resize(42, 24);
    await setup.renderOnce();
    await setup.flush();

    frame = setup.captureCharFrame();
    expect(frame).toContain("Compile & Deploy");
    expect(frame).toContain("State");
    expect(frame).toContain("Feed");
  });

  test("narrow Dev pane switching does not flash scrollbars for short content", async () => {
    const setup = await renderShell("zh-CN", 60, 20);

    setup.mockInput.pressTab();
    await setup.renderOnce();

    let frame = setup.captureCharFrame();
    expect(frame).toContain("状态快照加载中");
    expect(frame).not.toMatch(/[█▀▄]/);

    setup.mockInput.pressTab();
    await setup.renderOnce();

    frame = setup.captureCharFrame();
    expect(frame).toContain("滚动：0");
    expect(frame).not.toMatch(/[█▀▄]/);
  });

  test("Dev pane resize does not emit OpenTUI duplicate insertion warnings", async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };

    try {
      const setup = await renderShell("en-US", 42, 24, twoFunctionSession);

      for (const [width, height] of [[104, 28], [42, 24], [104, 28], [42, 24]] as const) {
        setup.resize(width, height);
        await setup.renderOnce();
        await setup.flush();
      }
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings.join("\n")).not.toContain("skipping insertBefore");
    expect(warnings.join("\n")).not.toContain("being inserted");
  });

  test("n opens the chain selector floating window", async () => {
    const setup = await renderShell("en-US", 80, 24, undefined, networkOptions);

    setup.mockInput.pressKey("n");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Chain selector");
    expect(frame).toContain("local / anvil");
    expect(frame).toContain("sepolia / remote");
    expect(frame).toContain("Dev");
  });

  test("n opens the chain selector without seeding the opener key into search", async () => {
    const setup = await renderShell("en-US", 80, 24, undefined, [
      { name: "local", label: "local / anvil", active: true },
      { name: "sepolia", label: "sepolia / remote", active: false },
    ]);

    setup.mockInput.pressKey("n");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("local / anvil");
    expect(frame).toContain("sepolia / remote");
    expect(frame).not.toContain("nlocal");
    expect(frame).not.toContain("Nlocal");
  });

  test("local chain selector actions include local lifecycle and state operations", async () => {
    const setup = await renderShell("en-US", 80, 24, undefined, networkOptions);

    setup.mockInput.pressKey("n");
    await setup.renderOnce();
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    await setup.flush();

    let frame = setup.captureCharFrame();
    expect(frame).toContain("Actions");
    expect(frame).toContain("Select");
    expect(frame).toContain("Start chain");
    expect(frame).toContain("Save state");
    expect(frame).toContain("Restore state");
    expect(frame).toContain("Reset chain");

    setup.mockInput.pressArrow("left");
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    await setup.flush();

    frame = setup.captureCharFrame();
    expect(frame).toContain("Actions");
    expect(frame).toContain("Select");
    expect(frame).not.toContain("Start chain");
    expect(frame).not.toContain("Save state");
    expect(frame).not.toContain("Restore state");
    expect(frame).not.toContain("Reset chain");
  });

  test("local chain save action opens a named state modal and submits it", async () => {
    const requests: Array<{ readonly action: string; readonly networkName: string; readonly stateName?: string }> = [];
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          networkOptions={networkOptions}
          onLocalChainAction={(request) => {
            requests.push(request);
            return { status: "ok", message: "saved" };
          }}
        />
      ),
      { width: 80, height: 24 },
    );
    await setup.flush();

    setup.mockInput.pressKey("n");
    await setup.renderOnce();
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("Save chain state");

    await setup.mockInput.typeText("baseline");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(requests).toEqual([{ action: "save_state", networkName: "local", stateName: "baseline" }]);
    expect(setup.captureCharFrame()).not.toContain("Save chain state");
  });

  test("local chain restore action opens a state picker and restores the selected state", async () => {
    const requests: Array<{ readonly action: string; readonly networkName: string; readonly stateName?: string }> = [];
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          networkOptions={networkOptions}
          onChainStatesRequest={() => [{ name: "baseline", label: "baseline", description: "block 12" }]}
          onLocalChainAction={(request) => {
            requests.push(request);
            return { status: "ok", message: "restored" };
          }}
        />
      ),
      { width: 80, height: 24 },
    );
    await setup.flush();

    setup.mockInput.pressKey("n");
    await setup.renderOnce();
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    let frame = setup.captureCharFrame();
    expect(frame).toContain("Chain states");
    expect(frame).toContain("baseline");
    expect(frame).toContain("block 12");

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(requests).toEqual([{ action: "restore_state", networkName: "local", stateName: "baseline" }]);
    frame = setup.captureCharFrame();
    expect(frame).not.toContain("Chain states");
  });

  test("a opens the account selector without seeding the opener key into search", async () => {
    const setup = await renderShell("en-US", 80, 24, undefined, undefined, undefined, accountOptions);

    setup.mockInput.pressKey("a");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Account selector");
    expect(frame).toContain("anvil0 / anvil-index");
    expect(frame).toContain("deployer / env-private-key");
    expect(frame).not.toContain("adeployer");
    expect(frame).not.toContain("Adeployer");
  });

  test("account selector shows addresses and balances for all account rows", async () => {
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          accountOptions={[
            {
              name: "anvil0",
              label: "anvil0 / 0xf39f...2266 / anvil-index",
              active: true,
              copyValue: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            },
            {
              name: "anvil1",
              label: "anvil1 / 0x7099...79c8 / anvil-index",
              active: false,
              copyValue: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
            },
          ]}
          accountStatus={{
            networkName: "local",
            accountName: "anvil0",
            address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            signer: "anvil-index",
            balanceWei: "1000000000000000000",
            balanceDisplay: "1.0000 ETH",
            status: "ok",
            message: null,
            accounts: [
              {
                accountName: "anvil0",
                address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
                signer: "anvil-index",
                balanceWei: "1000000000000000000",
                balanceDisplay: "1.0000 ETH",
                status: "ok",
                message: null,
              },
              {
                accountName: "anvil1",
                address: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
                signer: "anvil-index",
                balanceWei: "2500000000000000000",
                balanceDisplay: "2.5000 ETH",
                status: "ok",
                message: null,
              },
            ],
          }}
        />
      ),
      {
        width: 112,
        height: 28,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressKey("a");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("1.0000 ETH");
    expect(frame).toContain("2.5000 ETH");
    expect(frame).toContain("0xf39fd6...b92266");
    expect(frame).toContain("0x709979...dc79c8");
    expect(frame).not.toContain("1.0000 ETH ·");
    expect(frame).not.toContain("1000000000000000000 wei");
    expect(frame).not.toContain("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
    expect(frame).not.toContain("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
  });

  test("chain selector updates the active network with arrow and Enter", async () => {
    const setup = await renderShell("en-US", 80, 24, undefined, networkOptions);

    setup.mockInput.pressKey("n");
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("network [sepolia] {remote}");
    expect(frame).not.toContain("Chain selector");
  });

  test("chain selector filters networks through input", async () => {
    const setup = await renderShell("en-US", 80, 24, undefined, networkOptions);

    setup.mockInput.pressKey("n");
    await setup.renderOnce();
    await setup.mockInput.typeText("sep");
    await setup.renderOnce();
    await setup.flush();

    const filteredFrame = setup.captureCharFrame();
    expect(filteredFrame).toContain("sep");
    expect(filteredFrame).toContain("sepolia / remote");
    expect(filteredFrame).not.toContain("mainnet / typed-confirm");

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("network [sepolia] {remote}");
  });

  test("chain selector supports skipped fuzzy search", async () => {
    const setup = await renderShell("en-US", 80, 24, undefined, networkOptions);

    setup.mockInput.pressKey("n");
    await setup.renderOnce();
    await setup.mockInput.typeText("mtc");
    await setup.renderOnce();
    await setup.flush();

    const filteredFrame = setup.captureCharFrame();
    expect(filteredFrame).toContain("mainnet / typed-confirm");
    expect(filteredFrame).not.toContain("sepolia / remote");
  });

  test("chain selector supports mouse selection", async () => {
    const setup = await renderShell("en-US", 80, 24, undefined, networkOptions);

    setup.mockInput.pressKey("n");
    await setup.renderOnce();
    await setup.flush();
    await setup.mockMouse.click(31, 14);
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("network [sepolia] {remote}");
  });

  test("[ and ] switch real top-level tabs", async () => {
    const setup = await renderShell(
      "en-US",
      104,
      28,
      twoFunctionSession,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      transactionRecords,
      deployedForSession(twoFunctionSession),
    );

    let frame = setup.captureCharFrame();
    expect(frame).toContain("Dev");
    expect(frame).toContain("Transactions");
    expect(frame).toContain("setNumber(uint256)");

    setup.mockInput.pressKey("]");
    await setup.renderOnce();
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("╭─Transactions");
    expect(frame).toContain("↑/↓ select");
    expect(frame).not.toContain("Up/Down select a record");
    expect(frame).toContain("SEND");
    expect(frame).toContain("Counter");
    expect(frame).toContain("0x11111111");
    expect(frame).toContain("42123");

    setup.mockInput.pressKey("]");
    await setup.renderOnce();
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("╭─Events");
    expect(frame).toContain("No decoded events yet");
    expect(frame).not.toContain("c contracts");

    setup.mockInput.pressKey("]");
    await setup.renderOnce();
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("╭─Diagnostics");
    expect(frame).toContain("No build diagnostics");

    setup.mockInput.pressKey("]");
    await setup.renderOnce();
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("╭─Settings");
    expect(frame).toContain("Language");
    expect(frame).toContain("Display mode");

    setup.mockInput.pressKey("[");
    await setup.renderOnce();
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("╭─Diagnostics");
  });

  test("settings tab emits language preference changes", async () => {
    const changes: DevSettingsChange[] = [];
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          session={twoFunctionSession}
          settings={{
            language: "system",
            resolvedLocale: "en-US",
            systemLocale: "en-US",
            configPath: "/tmp/consol/config.toml",
            showRawStateValues: true,
            hideNoArgReadActions: false,
          }}
          onSettingsChange={(change) => {
            changes.push(change);
            return {
              language: change.language ?? "system",
              resolvedLocale: change.language === "system" || change.language === undefined ? "en-US" : change.language,
              configPath: "/tmp/consol/config.toml",
              showRawStateValues: change.showRawStateValues ?? true,
              hideNoArgReadActions: change.hideNoArgReadActions ?? false,
            };
          }}
        />
      ),
      {
        width: 104,
        height: 28,
        useMouse: true,
      },
    );
    await setup.flush();

    for (let index = 0; index < 4; index += 1) {
      setup.mockInput.pressKey("]");
      await setup.renderOnce();
    }
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("╭─Settings");
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Chinese (zh-CN)");
    expect(changes).toEqual([]);

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(changes).toEqual([{ language: "zh-CN" }]);
    expect(setup.captureCharFrame()).toContain("saved Chinese (zh-CN)");
    expect(setup.captureCharFrame()).toContain("Settings");
  });

  test("settings tab does not repeat the panel title inside the content", async () => {
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          session={twoFunctionSession}
          settings={{
            language: "system",
            resolvedLocale: "en-US",
            systemLocale: "en-US",
            showRawStateValues: true,
            hideNoArgReadActions: false,
          }}
        />
      ),
      {
        width: 104,
        height: 28,
        useMouse: true,
      },
    );
    await setup.flush();

    for (let index = 0; index < 4; index += 1) {
      setup.mockInput.pressKey("]");
      await setup.renderOnce();
    }
    await setup.flush();

    const contentTitleLines = setup.captureCharFrame()
      .split("\n")
      .filter((line) => /^│ Settings\s+│$/.test(line));
    expect(contentTitleLines).toHaveLength(0);
  });

  test("settings tab does not show duplicate language diagnostics", async () => {
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          session={twoFunctionSession}
          settings={{
            language: "system",
            resolvedLocale: "en-US",
            systemLocale: "zh-CN",
            showRawStateValues: true,
            hideNoArgReadActions: false,
          }}
        />
      ),
      {
        width: 104,
        height: 28,
        useMouse: true,
      },
    );
    await setup.flush();

    for (let index = 0; index < 4; index += 1) {
      setup.mockInput.pressKey("]");
      await setup.renderOnce();
    }
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("╭─Settings");
    expect(frame).toContain("Language");
    expect(frame).not.toContain("current UI:");
    expect(frame).not.toContain("system locale:");
  });

  test("settings tab does not render an inline Enter prompt on the selected row", async () => {
    const devShellSource = readFileSync(new URL("./DevShell.tsx", import.meta.url), "utf8");
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          session={twoFunctionSession}
          settings={{
            language: "system",
            resolvedLocale: "en-US",
            systemLocale: "en-US",
            showRawStateValues: true,
            hideNoArgReadActions: false,
          }}
        />
      ),
      {
        width: 104,
        height: 28,
        useMouse: true,
      },
    );
    await setup.flush();

    for (let index = 0; index < 4; index += 1) {
      setup.mockInput.pressKey("]");
      await setup.renderOnce();
    }
    await setup.flush();

    const languageLine = setup.captureCharFrame()
      .split("\n")
      .find((line) => line.includes("›") && line.includes("Language")) ?? "";
    expect(devShellSource).not.toContain('props.selected ? "Enter" : ""');
    expect(languageLine).toContain("Language");
    expect(languageLine).not.toContain("Enter");
  });

  test("settings tab saves compact state display from the single settings page", async () => {
    const changes: DevSettingsChange[] = [];
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          session={twoFunctionSession}
          settings={{
            language: "system",
            resolvedLocale: "en-US",
            systemLocale: "en-US",
            showRawStateValues: true,
            hideNoArgReadActions: false,
          }}
          onSettingsChange={(change) => {
            changes.push(change);
            return {
              language: change.language ?? "system",
              resolvedLocale: "en-US",
              showRawStateValues: change.showRawStateValues ?? true,
              hideNoArgReadActions: change.hideNoArgReadActions ?? false,
            };
          }}
        />
      ),
      {
        width: 104,
        height: 28,
        useMouse: true,
      },
    );
    await setup.flush();

    for (let index = 0; index < 4; index += 1) {
      setup.mockInput.pressKey("]");
      await setup.renderOnce();
    }
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressArrow("left");
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("Display mode");
    expect(setup.captureCharFrame()).toContain("Display: compact");
    expect(changes).toEqual([]);

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(changes).toEqual([{ showRawStateValues: false }]);
    expect(setup.captureCharFrame()).toContain("saved Display: compact");
  });

  test("settings tab saves the no-argument read action filter", async () => {
    const changes: DevSettingsChange[] = [];
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          session={twoFunctionSession}
          settings={{
            language: "system",
            resolvedLocale: "en-US",
            systemLocale: "en-US",
            showRawStateValues: true,
            hideNoArgReadActions: false,
          }}
          onSettingsChange={(change) => {
            changes.push(change);
            return {
              language: change.language ?? "system",
              resolvedLocale: "en-US",
              showRawStateValues: change.showRawStateValues ?? true,
              hideNoArgReadActions: change.hideNoArgReadActions ?? false,
            };
          }}
        />
      ),
      {
        width: 104,
        height: 28,
        useMouse: true,
      },
    );
    await setup.flush();

    for (let index = 0; index < 4; index += 1) {
      setup.mockInput.pressKey("]");
      await setup.renderOnce();
    }
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("Contract actions");
    expect(setup.captureCharFrame()).toContain("No-arg reads: hidden");
    expect(changes).toEqual([]);

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(changes).toEqual([{ hideNoArgReadActions: true }]);
    expect(setup.captureCharFrame()).toContain("saved No-arg reads: hidden");
  });

  test("c opens the deployed contracts selector", async () => {
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          session={twoFunctionSession}
          deployedContracts={deployedContracts}
        />
      ),
      {
        width: 104,
        height: 28,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressKey("c");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Deployed contracts");
    expect(frame).toContain("Counter");
    expect(frame).toContain("0x000000000000000000000000000000000000c0fe");
    expect(frame).toContain("abi");
    expect(frame).toContain("2 functions / 0 events / 0 errors");
    expect(frame).not.toContain("// functions");
    expect(frame).not.toContain("// tx");
  });

  test("deployed contracts selector opens item actions with right arrow", async () => {
    const deployedContract = deployedContracts[0];
    if (deployedContract === undefined) {
      throw new Error("missing deployed contract fixture");
    }
    const removed: string[] = [];
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          session={twoFunctionSession}
          deployedContracts={deployedContracts}
          onDeployedContractRemove={(id) => {
            removed.push(id);
          }}
        />
      ),
      {
        width: 104,
        height: 28,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressKey("c");
    await setup.renderOnce();
    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    await setup.flush();

    let frame = setup.captureCharFrame();
    expect(frame).toContain("Actions");
    expect(frame).toContain("Select");
    expect(frame).toContain("Copy address");
    expect(frame).toContain("Delete");

    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(removed).toEqual([deployedContract.id]);
    frame = setup.captureCharFrame();
    expect(frame).not.toContain("Deployed contracts");
  });

  test("deployed contracts selector shows a localized age label and refreshes it", async () => {
    const deployedContract = deployedContracts[0];
    if (deployedContract === undefined) {
      throw new Error("missing deployed contract fixture");
    }

    const createdAtUnix = Math.floor(Date.now() / 1000);
    const setup = await testRender(
      () => (
        <DevShell
          locale="zh-CN"
          session={twoFunctionSession}
          deployedContracts={[
            {
              ...deployedContract,
              createdAtUnix,
            },
          ]}
        />
      ),
      {
        width: 104,
        height: 28,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressKey("c");
    await setup.renderOnce();
    await setup.flush();

    let frame = setup.captureCharFrame();
    const firstAge = deployedAgeFromFrame(frame);
    expect(firstAge).not.toBeNull();
    expect(deployedSelectorTitleLine(frame)).toContain(`${firstAge}秒前`);
    expect(deployedSelectorAddressLine(frame)).not.toContain("秒前");

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await setup.renderOnce();
    await setup.flush();

    frame = setup.captureCharFrame();
    const nextAge = deployedAgeFromFrame(frame);
    expect(nextAge).not.toBeNull();
    expect(nextAge ?? 0).toBeGreaterThan(firstAge ?? 0);
    expect(deployedSelectorTitleLine(frame)).toContain(`${nextAge}秒前`);
    expect(deployedSelectorAddressLine(frame)).not.toContain("秒前");
  });

  test("deployed contracts selector deduplicates the same network address contract", async () => {
    const deployedContract = deployedContracts[0];
    if (deployedContract === undefined) {
      throw new Error("missing deployed contract fixture");
    }
    const duplicateContracts = [
      deployedContract,
      {
        ...deployedContract,
        id: "duplicate-local-counter",
        address: "0x000000000000000000000000000000000000C0FE",
        networkFingerprint: deployedContract.networkFingerprint,
        createdAtUnix: deployedContract.createdAtUnix + 1,
      },
    ].filter((contract): contract is DevDeployedContract => contract !== undefined);
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          session={twoFunctionSession}
          deployedContracts={duplicateContracts}
        />
      ),
      {
        width: 84,
        height: 28,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressKey("c");
    await setup.renderOnce();
    await setup.flush();

    const matches = setup.captureCharFrame().match(/0x000000\.\.\.00c0fe/gi) ?? [];
    expect(matches).toHaveLength(1);
  });

  test("dev panel groups source file, source contract, and deployed contract context", async () => {
    const setup = await renderShell("en-US", 104, 34, twoFunctionSession, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, deployedForSession(twoFunctionSession));

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Compile & Deploy");
    expect(frame).toContain("Current file  f choose file");
    expect(frame).toContain("src/Counter.sol");
    expect(frame).toContain("Select contract  ←/→ switch contract");
    expect(frame).not.toContain("Select contract  c");
    expect(frame).toContain("2 functions");
    expect(frame).toContain("constructor: constructor()");
    expect(frame).toContain("Deployed contract  c choose deployed contract");
    expect(frame).toContain("Counter 0x00000000...00c0fe");
    expect(frame).toContain("g filter reads");
    expect(frame).toContain("Enter");
    const lines = frame.split("\n");
    const sourceFileLine = lines.findIndex((line) => line.includes("src/Counter.sol"));
    const constructorLine = lines.findIndex((line) => line.includes("constructor: constructor()"));
    const deployedLine = lines.findIndex((line) => line.includes("Counter 0x00000000...00c0fe"));
    expect(lines[sourceFileLine + 1]).toContain("────");
    expect(lines[constructorLine + 1]).toContain("────");
    expect(lines[deployedLine + 1]).toContain("Read");
  });

  test("dev panel keeps info block dividers at narrow width", async () => {
    const setup = await renderShell("en-US", 42, 34, twoFunctionSession, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, deployedForSession(twoFunctionSession));

    const lines = setup.captureCharFrame().split("\n");
    const sourceFileLine = lines.findIndex((line) => line.includes("src/Counter.sol"));
    const constructorLine = lines.findIndex((line) => line.includes("constructor: constructor()"));
    expect(lines[sourceFileLine + 1]).toContain("────");
    expect(lines[constructorLine + 1]).toContain("────");
  });

  test("dev panel does not duplicate the no deployed contract empty state", async () => {
    const setup = await renderShell("en-US", 104, 28, twoFunctionSession);

    const frame = setup.captureCharFrame();
    const emptyStateMatches = frame.match(/no deployed contract selected/g) ?? [];
    expect(emptyStateMatches).toHaveLength(1);
    expect(frame).toContain("Choose a deployed contract to show functions.");
  });

  test("transaction detail modal renders RPC-derived fields when available", async () => {
    const baseRecord = transactionRecords[0];
    if (baseRecord === undefined) {
      throw new Error("missing transaction fixture");
    }

    const enrichedRecords = [
      {
        ...baseRecord,
        confirmations: "12",
        gasLimit: "50000",
        maxFeePerGas: "1000000000",
        maxPriorityFeePerGas: "200000000",
        input: "0xabcdef",
        logs: ["Transfer(address,address,uint256)"],
        blockTimestamp: "2026-06-03T00:00:07.000Z",
      },
    ] as const satisfies readonly (DevTransactionRecord & {
      readonly confirmations: string;
      readonly gasLimit: string;
      readonly maxFeePerGas: string;
      readonly maxPriorityFeePerGas: string;
      readonly input: string;
      readonly logs: readonly string[];
      readonly blockTimestamp: string;
    })[];
    const setup = await renderShell(
      "en-US",
      104,
      40,
      twoFunctionSession,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      enrichedRecords,
    );

    setup.mockInput.pressKey("]");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Transaction details");
    expect(frame).toContain("confirmations: 12");
    expect(frame).toContain("gas limit: 50000");
    expect(frame).toContain("max fee: 1000000000");
    expect(frame).toContain("priority fee: 200000000");
    expect(frame).toContain("input: 0xabcdef");
    expect(frame).toContain("logs/events: Transfer");
    expect(frame).toContain("timestamp: 2026-06-03T00:00:07.000Z");
  });

  test("transaction detail keeps formatted raw JSON visible above receipt fields", async () => {
    const baseRecord = transactionRecords[0];
    if (baseRecord === undefined) {
      throw new Error("missing transaction fixture");
    }
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          session={twoFunctionSession}
          transactions={[
            {
              ...baseRecord,
              args: ["1000000000000000000"],
              result: "Bank withdraw(uint256) -> 0xabc",
              rawOutput: "{\"ok\":true,\"data\":{\"hash\":\"0xabc\",\"count\":2}}",
              gasLimit: "33295",
              gasPrice: "9",
              maxFeePerGas: "17",
              maxPriorityFeePerGas: "1",
              effectiveGasPrice: "9",
              gasEstimate: "33295",
              from: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
              to: "0x88b9ad010a699cc0c8c5c5ea8baf90a0c375df1a",
              nonce: "851",
              input: "0x2e1a7d4d",
              calldataHash: "0x616c1b351eac188a86f38754a5c1bd217997963aa45c72ec74b142bb28e9dffd",
            },
          ]}
        />
      ),
      {
        width: 104,
        height: 40,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressKey("]");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("raw output:");
    expect(frame).toContain("  \"ok\": true,");
    expect(frame).toContain("    \"hash\": \"0xabc\"");
  });

  test("y copies the full transaction detail modal text", async () => {
    const copied: string[] = [];
    const baseRecord = transactionRecords[0];
    if (baseRecord === undefined) {
      throw new Error("missing transaction fixture");
    }
    const setup = await testRender(
      () => (
        <DevShell
          locale="en-US"
          session={twoFunctionSession}
          transactions={[
            {
              ...baseRecord,
              confirmations: "12",
              gasLimit: "50000",
              input: "0xabcdef",
              logs: ["Transfer(address,address,uint256)"],
            },
          ]}
          onCopyText={(text) => {
            copied.push(text);
          }}
        />
      ),
      {
        width: 104,
        height: 40,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressKey("]");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    setup.mockInput.pressKey("y");
    await setup.renderOnce();
    await setup.flush();

    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain("tx: 0x1111111111111111111111111111111111111111111111111111111111111111");
    expect(copied[0]).toContain("status: success");
    expect(copied[0]).toContain("gas limit: 50000");
    expect(copied[0]).toContain("input: 0xabcdef");
  });

  test("transactions render localized lifecycle status labels", async () => {
    const baseRecord = transactionRecords[0];
    if (baseRecord === undefined) {
      throw new Error("missing transaction fixture");
    }

    const localizedRecords: readonly DevTransactionRecord[] = [
      {
        ...baseRecord,
        id: "tx-sent",
        status: "sent",
        txHash: `0x${"a".repeat(64)}`,
        blockNumber: null,
        gasUsed: null,
      },
      {
        ...baseRecord,
        id: "tx-waiting",
        status: "pending",
        txHash: `0x${"b".repeat(64)}`,
        blockNumber: null,
        gasUsed: null,
      },
      {
        ...baseRecord,
        id: "tx-success",
        status: "success",
      },
      {
        ...baseRecord,
        id: "tx-reverted",
        status: "0x0",
        blockNumber: "8",
      },
    ];
    const setup = await renderShell(
      "zh-CN",
      104,
      48,
      twoFunctionSession,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      localizedRecords,
    );

    setup.mockInput.pressKey("]");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("交易已发出 (sent)");
    expect(frame).toContain("等待打包 (pending)");
    expect(frame).toContain("交易完成 (success)");
    expect(frame).toContain("已回滚 (reverted)");
    expect(frame.split("\n").find((line) => line.includes("SEND") && line.includes("交易已发出 (sent)")) ?? "").toContain("交易已发出 (sent)");
  });

  test("newest-first transactions keep reverse ordinal labels", async () => {
    const baseRecord = transactionRecords[0];
    if (baseRecord === undefined) {
      throw new Error("missing transaction fixture");
    }

    const records: readonly DevTransactionRecord[] = [
      {
        ...baseRecord,
        id: "tx-newest",
        functionName: "newest",
        signature: "newest()",
        txHash: `0x${"3".repeat(64)}`,
        createdAtUnix: 3_000,
      },
      {
        ...baseRecord,
        id: "tx-middle",
        functionName: "middle",
        signature: "middle()",
        txHash: `0x${"2".repeat(64)}`,
        createdAtUnix: 2_000,
      },
      {
        ...baseRecord,
        id: "tx-oldest",
        functionName: "oldest",
        signature: "oldest()",
        txHash: `0x${"1".repeat(64)}`,
        createdAtUnix: 1_000,
      },
    ];
    const setup = await renderShell(
      "en-US",
      104,
      48,
      twoFunctionSession,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      records,
    );

    setup.mockInput.pressKey("]");
    await setup.renderOnce();
    await setup.flush();

    const lines = setup.captureCharFrame().split("\n");
    expect(lines.find((line) => line.includes("newest()")) ?? "").toContain("[3]");
    expect(lines.find((line) => line.includes("middle()")) ?? "").toContain("[2]");
    expect(lines.find((line) => line.includes("oldest()")) ?? "").toContain("[1]");
  });

  test("non-dev tabs do not keep driving the Dev panel focus", async () => {
    const actions: DevAction[] = [];
    const setup = await renderShell(
      "en-US",
      104,
      28,
      twoFunctionSession,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (action) => {
        actions.push(action);
      },
      undefined,
      undefined,
      undefined,
      transactionRecords,
    );

    setup.mockInput.pressKey("]");
    await setup.renderOnce();
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("╭─Transactions");

    setup.mockInput.pressEnter();
    setup.mockInput.pressTab();
    await setup.renderOnce();
    await setup.flush();

    expect(actions).toEqual([]);
    expect(setup.captureCharFrame()).not.toContain("Function input");
  });

  test("mouse wheel scrolls long chain selector options", async () => {
    const manyNetworks = Array.from({ length: 18 }, (_, index) => {
      const number = String(index + 1).padStart(2, "0");
      return {
        name: `chain${number}`,
        label: `chain${number} / remote`,
        active: index === 0,
      };
    });
    const setup = await renderShell("en-US", 80, 18, undefined, manyNetworks);

    setup.mockInput.pressKey("n");
    await setup.renderOnce();
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("chain01 / remote");

    for (let index = 0; index < 11; index += 1) {
      await setup.mockMouse.scroll(31, 13, "down");
      await setup.renderOnce();
    }
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("chain12 / remote");
  });

  test("renders transaction preview as a floating modal", async () => {
    const setup = await renderShell("en-US", 92, 26, undefined, undefined, undefined, undefined, txPreviewModal);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Transaction preview");
    expect(frame).toContain("send Counter");
    expect(frame).toContain("local #31337");
    expect(frame).toContain("anvil0 / anvil-index");
    expect(frame).toContain("setPair((uint256,address))");
    expect(frame).toContain("function: setPair((uint256,address))");
    expect(frame).toContain("arg 1: (1,0x000000");
    expect(frame).toContain("Execution settings");
    expect(frame).toContain("editable gas limit");
    expect(frame).toContain("gas limit mode");
    expect(frame).toContain("[ auto ]");
    expect(frame).toContain("custom");
    expect(frame).toContain("gas: 42123");
    expect(frame).toContain("source: rpc_estimate");
    expect(frame).toContain("confidence: medium");
    expect(frame).toContain("hex: 0x1234567890abcdef");
    expect(frame).toContain("←/→ gas mode");
    expect(frame).toContain("Enter confirm | Esc cancel");
  });

  test("hides the custom gas limit input frame while gas limit mode is auto", async () => {
    const setup = await renderShell("en-US", 92, 26, undefined, undefined, undefined, undefined, txPreviewModal);
    const lines = setup.captureCharFrame().split("\n");
    const gasModeLineIndex = lines.findIndex((line) => line.includes("[ auto ]"));
    const laterNestedBorder = lines
      .slice(gasModeLineIndex + 1)
      .find((line) => /│\s+╭[─ ]+╮/.test(line));

    expect(gasModeLineIndex).toBeGreaterThan(-1);
    expect(laterNestedBorder).toBeUndefined();
  });

  test("renders deploy previews with the queued follow-up call", async () => {
    const setup = await renderShell("en-US", 92, 26, undefined, undefined, undefined, undefined, deployThenSendPreviewModal);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("Transaction preview");
    expect(frame).toContain("action: deploy Counter");
    expect(frame).toContain("Not deployed. Deploy first");
    expect(frame).toContain("after deploy: send setPair((uint256,address))");
    expect(frame).toContain("function: constructor()");
    expect(frame).toContain("arg 1: (1,0x000000");
    expect(frame).toContain("hex: 0x1234567890abcdef");
  });

  test("renders localized transaction preview labels", async () => {
    const setup = await renderShell("zh-CN", 92, 26, undefined, undefined, undefined, undefined, txPreviewModal);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("交易预览");
    expect(frame).toContain("操作: send Counter");
    expect(frame).toContain("网络: local #31337");
    expect(frame).toContain("账户: anvil0 / anvil-index");
    expect(frame).toContain("执行设置");
    expect(frame).toContain("可设置 gas 限额");
    expect(frame).toContain("函数: setPair((uint256,address))");
    expect(frame).toContain("Enter 确认 · Esc 取消");
  });

  test("renders localized custom gas limit tab and unit", async () => {
    const modal: DevModal = {
      ...txPreviewModal,
      gasLimitMode: "custom",
      gasLimitText: "50000",
    };
    const setup = await renderShell("zh-CN", 92, 26, undefined, undefined, undefined, undefined, modal);
    const frame = setup.captureCharFrame();

    expect(frame).toContain("[ 自定义 ]");
    expect(frame).not.toContain("╭─单位：gas");
    expect(frame.split("\n").some((line) => line.includes("╰") && line.includes("单位：gas"))).toBe(true);
    expect(frame).toContain("gas 限额: 50000");
  });

  test("Enter confirms the transaction preview", async () => {
    const confirmed: string[] = [];
    const cancelled: string[] = [];
    const setup = await renderShell(
      "en-US",
      92,
      26,
      undefined,
      undefined,
      undefined,
      undefined,
      txPreviewModal,
      (event) => {
        confirmed.push(event.id);
      },
      () => {
        cancelled.push("cancelled");
      },
    );

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(confirmed).toEqual(["preview-1"]);
    expect(cancelled).toEqual([]);
  });

  test("Enter dispatches a core transaction preview confirmation action", async () => {
    const actions: DevAction[] = [];
    const setup = await renderShell(
      "en-US",
      92,
      26,
      undefined,
      undefined,
      undefined,
      undefined,
      txPreviewModal,
      undefined,
      undefined,
      (action) => {
        actions.push(action);
      },
    );

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(actions).toEqual([{ type: "confirmTxPreview", previewId: "preview-1" }]);
  });

  test("Right switches transaction preview gas limit mode to custom", async () => {
    const actions: DevAction[] = [];
    const setup = await renderShell(
      "en-US",
      92,
      26,
      undefined,
      undefined,
      undefined,
      undefined,
      txPreviewModal,
      undefined,
      undefined,
      (action) => {
        actions.push(action);
      },
    );

    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    await setup.flush();

    expect(actions).toContainEqual({ type: "updateTxPreviewGasLimitMode", mode: "custom" });
  });

  test("Enter can drive core reducer confirmation from the transaction preview", async () => {
    let state = devReducer(createInitialDevState(), {
      type: "openDeployPreview",
      event: txPreviewModal.event,
    });
    const setup = await renderShell(
      "en-US",
      92,
      26,
      undefined,
      undefined,
      undefined,
      undefined,
      state.modal,
      undefined,
      undefined,
      (action) => {
        state = devReducer(state, action);
      },
    );

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(state.modal).toEqual({ type: "none" });
    expect(state.confirmedTxPreview).toEqual(txPreviewModal.event);
  });

  test("y does not confirm the transaction preview", async () => {
    const confirmed: string[] = [];
    const setup = await renderShell(
      "en-US",
      92,
      26,
      undefined,
      undefined,
      undefined,
      undefined,
      txPreviewModal,
      (event) => {
        confirmed.push(event.id);
      },
    );

    setup.mockInput.pressKey("y");
    await setup.renderOnce();
    await setup.flush();

    expect(confirmed).toEqual([]);
  });

  test("Esc cancels the transaction preview", async () => {
    const confirmed: string[] = [];
    const cancelled: string[] = [];
    const setup = await renderShell(
      "en-US",
      92,
      26,
      undefined,
      undefined,
      undefined,
      undefined,
      txPreviewModal,
      (event) => {
        confirmed.push(event.id);
      },
      () => {
        cancelled.push("cancelled");
      },
    );

    setup.mockInput.pressEscape();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    expect(confirmed).toEqual([]);
    expect(cancelled).toEqual(["cancelled"]);
  });

  test("Esc dispatches a core cancel modal action", async () => {
    const actions: DevAction[] = [];
    const setup = await renderShell(
      "en-US",
      92,
      26,
      undefined,
      undefined,
      undefined,
      undefined,
      txPreviewModal,
      undefined,
      undefined,
      (action) => {
        actions.push(action);
      },
    );

    setup.mockInput.pressEscape();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    expect(actions).toEqual([{ type: "cancelModal" }]);
  });
});
