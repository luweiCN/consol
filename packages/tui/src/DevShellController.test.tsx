/** @jsxImportSource @opentui/solid */
import { EventEmitter, setMaxListeners } from "node:events";
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createInitialDevState, devReducer } from "@consol/core";
import type { TxPreviewEvent } from "@consol/protocol";
import { DevShellController } from "./DevShellController";
import type { ConfirmedTxPreviewResult, DevDeployedContract, DevStateSnapshotRequest } from "./runtime-types";

EventEmitter.defaultMaxListeners = 200;
setMaxListeners(200);

const txPreview: TxPreviewEvent = {
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
};

const functionInputSession = {
  target: "Counter",
  contract: "Counter",
  sourceMode: "project",
  projectRoot: "/tmp/project",
  sourceFile: "src/Counter.sol",
  sourceFiles: ["src/Counter.sol", "src/Token.sol"],
  sourceTargets: [
    { sourceFile: "src/Counter.sol", contract: "Counter", target: "src/Counter.sol:Counter" },
    { sourceFile: "src/Token.sol", contract: "Token", target: "src/Token.sol:Token" },
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
      name: "setNumber",
      signature: "setNumber(uint256)",
      state_mutability: "nonpayable",
      kind: "write",
      inputs: [{ name: "value", kind: "uint256" }],
      outputs: [],
    },
  ],
} as const;

const tokenSession = {
  ...functionInputSession,
  target: "src/Token.sol:Token",
  contract: "Token",
  sourceFile: "src/Token.sol",
  artifactPath: "/tmp/project/out/Token.sol/Token.json",
  functions: [
    {
      name: "symbol",
      signature: "symbol()",
      state_mutability: "view",
      kind: "read",
      inputs: [],
      outputs: [{ name: "", kind: "string" }],
    },
  ],
} as const;

function deployedContractForSession(
  session: Pick<DevDeployedContract, "contract" | "target" | "sourceFile" | "abiSummary" | "constructor" | "functions">,
  address = "0x000000000000000000000000000000000000c0fe",
): DevDeployedContract {
  return {
    id: `local:${session.contract}:${address.toLowerCase()}`,
    contract: session.contract,
    address,
    target: session.target,
    sourceFile: session.sourceFile,
    network: "local",
    chainId: "31337",
    networkFingerprint: "local:31337:localhost",
    account: "anvil0",
    deployTxHash: null,
    status: "ready",
    constructorArgs: [],
    value: null,
    abiSummary: session.abiSummary,
    constructor: session.constructor,
    functions: session.functions,
    createdAtUnix: 1_801_526_400,
  };
}

describe("DevShellController", () => {
  test("loads a dev session after selecting an entry picker option", async () => {
    const selected: string[] = [];
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          entryOptions={[{ name: "counter", label: "src/Counter.sol:Counter", active: false }]}
          onEntrySelect={(option) => {
            selected.push(option.name);
            return functionInputSession;
          }}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("File picker");

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    expect(selected).toEqual(["counter"]);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Counter");
    expect(frame).toContain("no deployed contract selected");
  });

  test("owns core dev state and emits confirmed transaction previews", async () => {
    const initialState = devReducer(createInitialDevState(), {
      type: "openDeployPreview",
      event: txPreview,
    });
    const confirmed: string[] = [];
    const states: string[] = [];
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          initialState={initialState}
          onConfirmedTxPreview={(event) => {
            confirmed.push(event.id);
          }}
          onStateChange={(state) => {
            states.push(state.modal.type);
          }}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("Transaction preview");

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(confirmed).toEqual(["preview-1"]);
    expect(states).toContain("none");
    const frame = setup.captureCharFrame();
    expect(frame).not.toContain("action: send Counter");
    expect(frame).not.toContain("Enter confirm | Esc cancel");
  });

  test("shows successful confirmed preview results in the feed", async () => {
    const initialState = devReducer(createInitialDevState(), {
      type: "openDeployPreview",
      event: txPreview,
    });
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          initialState={initialState}
          onConfirmedTxPreview={async () => ({
            status: "ok",
            message: "Counter setPair((uint256,address)) -> 0xsendtx",
          })}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("sent send Counter");
    expect(frame).toContain("Counter setPair((");
    expect(frame).toContain("uint256,address");
    expect(frame).toContain("0xsendtx");
  });

  test("opens the next transaction preview after a confirmed deploy", async () => {
    const deployPreview: TxPreviewEvent = {
      ...txPreview,
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
        calldata: txPreview.calldata,
      },
    };
    const initialState = devReducer(createInitialDevState(), {
      type: "openDeployPreview",
      event: deployPreview,
    });
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          initialState={initialState}
          onConfirmedTxPreview={async () => ({
            status: "ok",
            message: "Counter deployed -> 0xdeploy",
            nextPreview: txPreview,
          })}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Transaction preview");
    expect(frame).toContain("action: send Counter");
    expect(frame).toContain("function: setPair((uint256,address))");
  });

  test("shows a pending feed entry while a confirmed preview is executing", async () => {
    const initialState = devReducer(createInitialDevState(), {
      type: "openDeployPreview",
      event: txPreview,
    });
    let resolveResult: ((result: ConfirmedTxPreviewResult) => void) | undefined;
    const resultPromise = new Promise<ConfirmedTxPreviewResult>((resolve) => {
      resolveResult = resolve;
    });
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          initialState={initialState}
          onConfirmedTxPreview={async () => resultPromise}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("sending send Counter");

    resolveResult?.({
      status: "ok",
      message: "Counter setPair((uint256,address)) -> 0xsendtx",
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("sent send Counter");
  });

  test("records a pending transaction immediately while a confirmed preview is executing", async () => {
    const initialState = devReducer(createInitialDevState(), {
      type: "openDeployPreview",
      event: txPreview,
    });
    let resolveResult: ((result: ConfirmedTxPreviewResult) => void) | undefined;
    const resultPromise = new Promise<ConfirmedTxPreviewResult>((resolve) => {
      resolveResult = resolve;
    });
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          initialState={initialState}
          onConfirmedTxPreview={async () => resultPromise}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    setup.mockInput.pressKey("]");
    await setup.renderOnce();
    await setup.flush();

    const pendingFrame = setup.captureCharFrame();
    expect(pendingFrame).toContain("SEND");
    expect(pendingFrame).toContain("pending");
    expect(pendingFrame.match(/SEND/g)?.length ?? 0).toBe(1);

    resolveResult?.({
      status: "ok",
      message: "Counter setPair((uint256,address)) -> 0xsendtx",
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    const minedFrame = setup.captureCharFrame();
    expect(minedFrame).toContain("success");
    expect(minedFrame).not.toContain("pending");
    expect(minedFrame.match(/SEND/g)?.length ?? 0).toBe(1);
  });

  test("merges confirmed session transactions with refreshed history by tx hash", async () => {
    const txHash = `0x${"b".repeat(64)}`;
    const initialState = devReducer(createInitialDevState(), {
      type: "openDeployPreview",
      event: txPreview,
    });
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          initialState={initialState}
          onConfirmedTxPreview={async () => ({
            status: "ok",
            message: `Counter setPair((uint256,address)) -> ${txHash}`,
            transaction: {
              id: txHash,
              previewId: txPreview.id,
              action: "send",
              contract: "Counter",
              target: "src/Counter.sol:Counter",
              functionName: "setPair",
              signature: "setPair((uint256,address))",
              args: txPreview.calldata.args,
              result: "Counter setPair((uint256,address)) mined",
              rawOutput: "Counter setPair((uint256,address)) mined",
              txHash,
              blockNumber: "123",
              status: "success",
              gasUsed: "21000",
              network: "local",
              account: "anvil0",
              createdAtUnix: 1780516900,
            },
          })}
          onTransactionsRequest={() => [
            {
              id: txHash,
              action: "send",
              contract: "Counter",
              target: "src/Counter.sol:Counter",
              functionName: "setPair",
              signature: "setPair((uint256,address))",
              args: txPreview.calldata.args,
              result: "history record",
              rawOutput: "history record",
              txHash,
              blockNumber: "123",
              status: "success",
              gasUsed: "21000",
              network: "local",
              account: "anvil0",
              createdAtUnix: 1780516900,
            },
          ]}
        />
      ),
      {
        width: 112,
        height: 30,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    setup.mockInput.pressKey("]");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("success");
    expect(frame).toContain("0xbbbbbbbb");
    expect(frame.match(/SEND/g)?.length ?? 0).toBe(1);
  });

  test("renders RPC-enriched transaction fields from confirmed preview results", async () => {
    const txHash = `0x${"a".repeat(64)}`;
    const initialState = devReducer(createInitialDevState(), {
      type: "openDeployPreview",
      event: txPreview,
    });
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          initialState={initialState}
          onConfirmedTxPreview={async () => ({
            status: "ok",
            message: "Counter setPair((uint256,address)) mined",
            transaction: {
              id: `session:${txPreview.id}`,
              action: "send",
              contract: "Counter",
              target: "src/Counter.sol:Counter",
              functionName: "setPair",
              signature: "setPair((uint256,address))",
              args: txPreview.calldata.args,
              result: "Counter setPair((uint256,address)) mined",
              rawOutput: "Counter setPair((uint256,address)) mined",
              txHash,
              blockNumber: "123",
              confirmations: "4",
              status: "success",
              gasUsed: "21000",
              gasLimit: "50000",
              network: "local",
              chainId: "31337",
              account: "anvil0",
              from: txPreview.account.address,
              to: "0x000000000000000000000000000000000000c0fe",
              nonce: "7",
              gasPrice: "1000000000",
              input: txPreview.calldata.hex,
              logs: ["Updated 0x000000000000000000000000000000000000c0fe"],
              blockTimestamp: "1780517000",
              createdAtUnix: 1780516900,
            },
          })}
        />
      ),
      {
        width: 112,
        height: 30,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    setup.mockInput.pressKey("]");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("success");
    expect(frame).toContain("123");
    expect(frame).toContain("21000");
    expect(frame).toContain("4");
    expect(frame).toContain("0xaaaaaaaa");
  });

  test("starts a runtime block watcher and refreshes account state and transactions on new blocks", async () => {
    let emitBlock: ((blockNumber: string) => void) | undefined;
    let stopped = false;
    let accountRefreshes = 0;
    let stateRefreshes = 0;
    let transactionRefreshes = 0;
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={tokenSession}
          deployedContracts={[deployedContractForSession(tokenSession)]}
          accountStatus={{
            networkName: "local",
            accountName: "anvil0",
            address: txPreview.account.address,
            signer: "anvil-index",
            balanceWei: "1",
            balanceDisplay: "0.0000 ETH",
            status: "ok",
            message: null,
          }}
          onBlockWatchStart={(_input, onBlockNumber) => {
            emitBlock = onBlockNumber;
            return () => {
              stopped = true;
            };
          }}
          onAccountStatusRequest={(selection) => {
            accountRefreshes += 1;
            return {
              ...selection,
              address: txPreview.account.address,
              signer: "anvil-index",
              balanceWei: String(accountRefreshes + 1),
              balanceDisplay: "0.0000 ETH",
              status: "ok",
              message: null,
            };
          }}
          onStateSnapshotRequest={() => {
            stateRefreshes += 1;
            return {
              status: { status: "ready", message: null, hint: null },
              address: "0x000000000000000000000000000000000000c0fe",
              values: [],
            };
          }}
          onTransactionsRequest={() => {
            transactionRefreshes += 1;
            return [];
          }}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();
    accountRefreshes = 0;
    stateRefreshes = 0;
    transactionRefreshes = 0;

    expect(emitBlock).toBeDefined();
    emitBlock?.("123");
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    expect(accountRefreshes).toBe(1);
    expect(stateRefreshes).toBe(1);
    expect(transactionRefreshes).toBe(1);

    setup.renderer.destroy();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(stopped).toBe(true);
  });

  test("renders sent and mined lifecycle events distinctly in the feed", async () => {
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          initialState={{
            ...createInitialDevState(),
            feed: [
              {
                type: "tx.sent",
                id: "sent-1",
                timestamp: "2026-06-03T00:00:01.000Z",
                hash: `0x${"1".repeat(64)}`,
                network: txPreview.network,
              },
              {
                type: "tx.mined",
                id: "mined-1",
                timestamp: "2026-06-03T00:00:02.000Z",
                hash: `0x${"2".repeat(64)}`,
                status: "success",
                gas: {
                  source: "actual",
                  estimate: "21000",
                  confidence: "high",
                },
              },
            ],
          }}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("sent tx 0x11111111");
    expect(frame).toContain("mined success");
    expect(frame).toContain("0x22222222");
  });

  test("shows failed confirmed preview results in the feed", async () => {
    const initialState = devReducer(createInitialDevState(), {
      type: "openDeployPreview",
      event: txPreview,
    });
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          initialState={initialState}
          onConfirmedTxPreview={async () => {
            throw new Error("cast send failed");
          }}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("failed send Counter");
    expect(frame).toContain("cast send failed");
  });

  test("opens function input from the contract panel and submits it into a transaction preview", async () => {
    const submittedActions: string[] = [];
    const submittedArgs: string[][] = [];
    const submittedValues: Array<string | null> = [];
    const submittedGasLimits: Array<string | null | undefined> = [];
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={functionInputSession}
          deployedContracts={[deployedContractForSession(functionInputSession)]}
          onFunctionInputSubmit={(submission) => {
            submittedActions.push(submission.action);
            submittedArgs.push([...submission.args]);
            submittedValues.push(submission.value);
            submittedGasLimits.push(submission.gasLimit);
            return {
              ...txPreview,
              id: "preview-from-input",
              calldata: {
                function: submission.function.name,
                signature: submission.function.signature,
                args: [...submission.args],
                hex: "0x1234",
              },
            };
          }}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("Function input");
    expect(setup.captureCharFrame()).toContain("setNumber(uint256)");
    expect(setup.captureCharFrame()).not.toContain("optional value");

    await setup.mockInput.typeText("42");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    expect(submittedActions).toEqual(["send"]);
    expect(submittedArgs).toEqual([["42"]]);
    expect(submittedValues).toEqual([null]);
    expect(submittedGasLimits).toEqual([null]);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Transaction preview");
    expect(frame).toContain("setNumber(uint256)");
    expect(frame).toContain("0x1234");
  });

  test("custom gas limit is edited in transaction preview for a no-arg write function", async () => {
    const submittedGasLimits: Array<string | null | undefined> = [];
    const confirmedGasLimits: Array<unknown> = [];
    const modalGasModes: string[] = [];
    const noArgWriteSession = {
      ...functionInputSession,
      functions: [
        {
          name: "click",
          signature: "click()",
          state_mutability: "nonpayable",
          kind: "write",
          inputs: [],
          outputs: [],
        },
      ],
    } as const;
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={noArgWriteSession}
          deployedContracts={[deployedContractForSession(noArgWriteSession)]}
          onFunctionInputSubmit={(submission) => {
            submittedGasLimits.push(submission.gasLimit);
            return {
              ...txPreview,
              id: `preview-gas-${submittedGasLimits.length}`,
              calldata: {
                function: submission.function.name,
                signature: submission.function.signature,
                args: [...submission.args],
                hex: "0x1234",
              },
            };
          }}
          onConfirmedTxPreview={(event) => {
            confirmedGasLimits.push(event.gas.context?.["gasLimit"]);
            return { status: "ok", message: "sent" };
          }}
          onStateChange={(state) => {
            if (state.modal.type === "txPreview") {
              modalGasModes.push(state.modal.gasLimitMode);
            }
          }}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();
    expect(submittedGasLimits).toEqual([null]);
    expect(setup.captureCharFrame()).toContain("Transaction preview");
    expect(setup.captureCharFrame()).toContain("[ auto ]");
    expect(setup.captureCharFrame()).toContain("custom");
    expect(setup.captureCharFrame()).not.toContain("custom gas limit");

    setup.mockInput.pressArrow("right");
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();
    expect(modalGasModes.at(-1)).toBe("custom");
    expect(setup.captureCharFrame()).toContain("[ custom ]");
    expect(setup.captureCharFrame()).toContain("custom gas limit");

    await setup.mockInput.typeText("50000");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    expect(confirmedGasLimits).toEqual(["50000"]);
  });

  test("Esc from transaction preview returns to the function input with previous values", async () => {
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={functionInputSession}
          deployedContracts={[deployedContractForSession(functionInputSession)]}
          onFunctionInputSubmit={(submission) => ({
            ...txPreview,
            id: "preview-return-to-input",
            calldata: {
              function: submission.function.name,
              signature: submission.function.signature,
              args: [...submission.args],
              hex: "0x1234",
            },
          })}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.mockInput.typeText("42");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("Transaction preview");

    setup.mockInput.pressEscape();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Function input");
    expect(frame).toContain("42");
  });

  test("Tab moves between function parameters and Ctrl+U clears the active parameter", async () => {
    const submittedArgs: string[][] = [];
    const transferSession = {
      ...functionInputSession,
      functions: [
        {
          name: "transfer",
          signature: "transfer(address,uint256)",
          state_mutability: "nonpayable",
          kind: "write",
          inputs: [
            { name: "to", kind: "address" },
            { name: "amount", kind: "uint256" },
          ],
          outputs: [],
        },
      ],
    } as const;
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={transferSession}
          deployedContracts={[deployedContractForSession(transferSession)]}
          onFunctionInputSubmit={(submission) => {
            submittedArgs.push([...submission.args]);
            return {
              ...txPreview,
              id: "preview-from-two-args",
              calldata: {
                function: submission.function.name,
                signature: submission.function.signature,
                args: [...submission.args],
                hex: "0x1234",
              },
            };
          }}
        />
      ),
      {
        width: 96,
        height: 28,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.mockInput.typeText("bad");
    setup.mockInput.pressKey("u", { ctrl: true });
    await setup.renderOnce();
    await setup.mockInput.typeText("0xabc");
    setup.mockInput.pressTab();
    await setup.renderOnce();
    await setup.mockInput.typeText("100");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    expect(submittedArgs).toEqual([["0xabc", "100"]]);
    expect(setup.captureCharFrame()).toContain("Transaction preview");
  });

  test("Up and Down recall previous function input parameters", async () => {
    const submittedArgs: string[][] = [];
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={functionInputSession}
          deployedContracts={[deployedContractForSession(functionInputSession)]}
          onFunctionInputSubmit={(submission) => {
            submittedArgs.push([...submission.args]);
            return {
              ...txPreview,
              id: `preview-${submittedArgs.length}`,
              calldata: {
                function: submission.function.name,
                signature: submission.function.signature,
                args: [...submission.args],
                hex: "0x1234",
              },
            };
          }}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.mockInput.typeText("42");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Transaction preview");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();
    expect(setup.captureCharFrame()).not.toContain("Transaction preview");

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("Function input");
    setup.mockInput.pressArrow("up");
    await setup.renderOnce();
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("42");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    expect(submittedArgs).toEqual([["42"], ["42"]]);
  });

  test("keeps function input open and shows validation errors inline", async () => {
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={functionInputSession}
          deployedContracts={[deployedContractForSession(functionInputSession)]}
          onFunctionInputSubmit={() => {
            throw new Error("invalid uint256 value");
          }}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.mockInput.typeText("bad");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Function input");
    expect(frame).toContain("invalid uint256 value");
    expect(frame).not.toContain("Transaction preview");
  });

  test("directly submits a no-arg read function into the feed", async () => {
    const submittedActions: string[] = [];
    let stateRefreshes = 0;
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={tokenSession}
          deployedContracts={[deployedContractForSession(tokenSession)]}
          onFunctionInputSubmit={(submission) => {
            submittedActions.push(submission.action);
            return { status: "ok", message: `${submission.session.contract} ${submission.function.signature} -> 42` };
          }}
          onStateSnapshotRequest={() => {
            stateRefreshes += 1;
            return {
              status: { status: "ready", message: null, hint: null },
              address: "0x000000000000000000000000000000000000c0fe",
              values: [],
            };
          }}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();
    stateRefreshes = 0;

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    expect(submittedActions).toEqual(["read"]);
    expect(stateRefreshes).toBe(1);
    expect(setup.captureCharFrame()).toContain("Token symbol() -> 42");
  });

  test("records direct read results in the transactions tab", async () => {
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={tokenSession}
          deployedContracts={[deployedContractForSession(tokenSession)]}
          onFunctionInputSubmit={(submission) => ({
            status: "ok",
            message: `${submission.session.contract} ${submission.function.signature} -> 42`,
          })}
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
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    setup.mockInput.pressKey("]");
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("╭─Transactions");
    expect(frame).toContain("READ");
    expect(frame).toContain("Token");
    expect(frame).toContain("symbol()");
    expect(frame).toContain("42");
  });

  test("copies the selected account address from the account selector", async () => {
    const copied: string[] = [];
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          accountOptions={[
            {
              name: "runner",
              label: "runner / 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa / keystore",
              active: true,
            },
            {
              name: "deployer",
              label: "deployer / 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb / env-private-key",
              active: false,
            },
          ]}
          copySelectedText={(text) => {
            copied.push(text);
          }}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressKey("a");
    await setup.renderOnce();
    setup.mockInput.pressKey("y", { ctrl: true });
    await setup.renderOnce();
    await setup.flush();

    expect(copied).toEqual(["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    expect(setup.captureCharFrame()).toContain("Ctrl+Y copy address");
  });

  test("transaction detail y falls back to the system clipboard writer", async () => {
    const copied: string[] = [];
    const txHash = `0x${"c".repeat(64)}`;
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={functionInputSession}
          transactions={[
            {
              id: txHash,
              action: "send",
              contract: "Counter",
              target: "src/Counter.sol:Counter",
              functionName: "setNumber",
              signature: "setNumber(uint256)",
              args: ["42"],
              result: null,
              rawOutput: null,
              txHash,
              blockNumber: "8",
              status: "success",
              gasUsed: "42123",
              network: "local",
              account: "anvil0",
              createdAtUnix: 1_801_526_400,
            },
          ]}
          copyToSystemClipboard={(text) => {
            copied.push(text);
          }}
        />
      ),
      {
        width: 104,
        height: 36,
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
    expect(copied[0]).toContain(txHash);
    expect(copied[0]).toContain("function: setNumber");
  });

  test("deploy opener key does not seed the constructor argument input", async () => {
    const submittedArgs: string[][] = [];
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={{
            ...functionInputSession,
            constructor: {
              signature: "constructor(uint256)",
              state_mutability: "nonpayable",
              inputs: [{ name: "initial", kind: "uint256" }],
            },
          }}
          onFunctionInputSubmit={(submission) => {
            submittedArgs.push([...submission.args]);
            return { status: "ok", message: "preview ok" };
          }}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressKey("d");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(submittedArgs).toEqual([[""]]);
  });

  test("function input history recalls only the active parameter and Down clears it after the newest value", async () => {
    const submittedArgs: string[][] = [];
    const transferSession = {
      ...functionInputSession,
      functions: [
        {
          name: "transfer",
          signature: "transfer(address,uint256)",
          state_mutability: "nonpayable",
          kind: "write",
          inputs: [
            { name: "to", kind: "address" },
            { name: "amount", kind: "uint256" },
          ],
          outputs: [],
        },
      ],
    } as const;
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={transferSession}
          deployedContracts={[deployedContractForSession(transferSession)]}
          onFunctionInputSubmit={(submission) => {
            submittedArgs.push([...submission.args]);
            return {
              ...txPreview,
              id: `preview-history-${submittedArgs.length}`,
              calldata: {
                function: submission.function.name,
                signature: submission.function.signature,
                args: [...submission.args],
                hex: "0x1234",
              },
            };
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

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.mockInput.typeText("0xaaa");
    setup.mockInput.pressTab();
    await setup.renderOnce();
    await setup.mockInput.typeText("100");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.mockInput.typeText("0xbbb");
    setup.mockInput.pressTab();
    await setup.renderOnce();
    await setup.mockInput.typeText("200");
    await setup.renderOnce();
    setup.mockInput.pressArrow("up");
    await setup.renderOnce();
    await setup.flush();

    let frame = setup.captureCharFrame();
    expect(frame).toContain("0xbbb");
    expect(frame).toContain("100");

    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    frame = setup.captureCharFrame();
    expect(frame).toContain("Transaction preview");
    expect(submittedArgs).toEqual([
      ["0xaaa", "100"],
      ["0xbbb", ""],
    ]);
  });

  test("manual refresh writes success feedback to the feed", async () => {
    let refreshes = 0;
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={tokenSession}
          deployedContracts={[deployedContractForSession(tokenSession)]}
          onStateSnapshotRequest={() => {
            refreshes += 1;
            return {
              status: { status: "ready", message: null, hint: null },
              address: "0x000000000000000000000000000000000000c0fe",
              values: [],
            };
          }}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();
    refreshes = 0;

    setup.mockInput.pressKey("r");
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    expect(refreshes).toBe(1);
    expect(setup.captureCharFrame()).toContain("refreshed Token");
  });

  test("state snapshot follows the selected deployed contract", async () => {
    const first = deployedContractForSession(tokenSession, "0x0000000000000000000000000000000000001111");
    const second = {
      ...deployedContractForSession(tokenSession, "0x0000000000000000000000000000000000002222"),
      createdAtUnix: first.createdAtUnix - 1,
    };
    const requests: DevStateSnapshotRequest[] = [];
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={tokenSession}
          deployedContracts={[first, second]}
          onStateSnapshotRequest={(request) => {
            requests.push(request);
            return {
              status: { status: "ready", message: `loaded ${request.deployedContract?.address ?? "none"}`, hint: null },
              address: request.deployedContract?.address ?? null,
              values: [],
            };
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

    setup.mockInput.pressKey("c");
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    expect(requests.at(-1)?.deployedContract?.address).toBe(second.address);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("loaded 0x0000000000000000000000000000000000002222");
    expect(frame).toContain("0x0000000000000000000000000000000000002222");
  });

  test("state mapping detail can add a key book entry", async () => {
    const changes: unknown[] = [];
    const contexts: unknown[] = [];
    const savedKeys: Array<{ readonly type: string; readonly value: string; readonly label: string | null }> = [];
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={functionInputSession}
          deployedContracts={[deployedContractForSession(functionInputSession)]}
          stateSnapshot={{
            status: { status: "ready", message: "state loaded", hint: null },
            address: "0x000000000000000000000000000000000000c0fe",
            values: [],
            storageLayoutId: "layout:abc123",
            storageValues: [
              {
                id: "storage:balances",
                kind: "mapping",
                name: "balances",
                typeLabel: "mapping(address => uint256)",
                summary: "0 checked",
                detailAvailable: true,
              },
            ],
          }}
          onStateDetailRequest={(request) => ({
            rowId: request.rowId,
            title: "balances detail",
            lines: [
              "balances  mapping(address => uint256)",
              savedKeys.length === 0 ? "summary: no compatible keys" : "summary: owner=7 (1 checked)",
              "",
              ...savedKeys.map((key) => `${key.label ?? key.value}: 7  raw=0x07`),
            ],
            copyValue: "",
            keyBookEntries: savedKeys.map((key, index) => ({
              type: key.type,
              value: key.value,
              label: key.label,
              lineIndex: index + 3,
            })),
          })}
          onStateKeyBookChange={(change, context) => {
            changes.push(change);
            contexts.push(context);
            if (change.action === "add_key") {
              savedKeys.push(change.key);
            }
          }}
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
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    setup.mockInput.pressKey("k");
    await setup.renderOnce();
    setup.mockInput.pressKey("a");
    await setup.renderOnce();
    await setup.flush();

    let frame = setup.captureCharFrame();
    expect(frame).toContain("Add key");
    expect(frame).not.toContain("Key Book");

    await setup.mockInput.typeText("0x000000000000000000000000000000000000c0fe");
    setup.mockInput.pressTab();
    await setup.renderOnce();
    await setup.mockInput.typeText("owner");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(changes).toEqual([
      {
        action: "add_key",
        layoutId: "layout:abc123",
        target: functionInputSession.target,
        contract: functionInputSession.contract,
        key: {
          type: "address",
          value: "0x000000000000000000000000000000000000c0fe",
          label: "owner",
          enabled: true,
        },
      },
    ]);
    expect(contexts).toEqual([{ session: functionInputSession }]);
    frame = setup.captureCharFrame();
    expect(frame).toContain("Key Book");
    expect(frame).toContain("owner");
  });

  test("state mapping detail can delete a displayed key book entry", async () => {
    const changes: unknown[] = [];
    const detailRequests: unknown[] = [];
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={functionInputSession}
          deployedContracts={[deployedContractForSession(functionInputSession)]}
          stateSnapshot={{
            status: { status: "ready", message: "state loaded", hint: null },
            address: "0x000000000000000000000000000000000000c0fe",
            values: [],
            storageLayoutId: "layout:abc123",
            storageValues: [
              {
                id: "storage:balances",
                kind: "mapping",
                name: "balances",
                typeLabel: "mapping(address => uint256)",
                summary: "owner=7 (1 checked)",
                detailAvailable: true,
              },
            ],
          }}
          onStateDetailRequest={(request) => {
            detailRequests.push(request);
            return {
              rowId: request.rowId,
              title: "balances detail",
              lines: [
                "balances  mapping(address => uint256)",
                "summary: owner=7 (1 checked)",
                "",
                "owner: 7  raw=0x07",
              ],
              copyValue: "owner: 7  raw=0x07",
              keyBookEntries: [
                {
                  type: "address",
                  value: "0x000000000000000000000000000000000000c0fe",
                  label: "owner",
                  lineIndex: 3,
                },
              ],
            };
          }}
          onStateKeyBookChange={(change) => {
            changes.push(change);
          }}
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
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("k Key");

    setup.mockInput.pressKey("k");
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("Key Book");
    expect(setup.captureCharFrame()).toContain("owner");

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("Key actions");

    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    expect(changes).toEqual([
      {
        action: "delete_key",
        layoutId: "layout:abc123",
        type: "address",
        value: "0x000000000000000000000000000000000000c0fe",
      },
    ]);
    expect(detailRequests.length).toBeGreaterThanOrEqual(2);
  });

  test("state mapping key list can edit a key label", async () => {
    const changes: unknown[] = [];
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={functionInputSession}
          deployedContracts={[deployedContractForSession(functionInputSession)]}
          stateSnapshot={{
            status: { status: "ready", message: "state loaded", hint: null },
            address: "0x000000000000000000000000000000000000c0fe",
            values: [],
            storageLayoutId: "layout:abc123",
            storageValues: [
              {
                id: "storage:balances",
                kind: "mapping",
                name: "balances",
                typeLabel: "mapping(address => uint256)",
                summary: "owner=7 (1 checked)",
                detailAvailable: true,
              },
            ],
          }}
          onStateDetailRequest={(request) => ({
            rowId: request.rowId,
            title: "balances detail",
            lines: [
              "balances  mapping(address => uint256)",
              "summary: owner=7 (1 checked)",
              "",
              "owner: 7  raw=0x07",
            ],
            copyValue: "owner: 7  raw=0x07",
            keyBookEntries: [
              {
                type: "address",
                value: "0x000000000000000000000000000000000000c0fe",
                label: "owner",
                lineIndex: 3,
              },
            ],
          })}
          onStateKeyBookChange={(change) => {
            changes.push(change);
          }}
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
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    setup.mockInput.pressKey("k");
    await setup.renderOnce();
    setup.mockInput.pressKey("/");
    await setup.renderOnce();
    await setup.mockInput.typeText("own");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("own");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.mockInput.typeText("2");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(changes).toEqual([
      {
        action: "add_key",
        layoutId: "layout:abc123",
        target: functionInputSession.target,
        contract: functionInputSession.contract,
        key: {
          type: "address",
          value: "0x000000000000000000000000000000000000c0fe",
          label: "owner2",
          enabled: true,
        },
      },
    ]);
  });

  test("state detail request replaces the storage row summary", async () => {
    const requests: unknown[] = [];
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={functionInputSession}
          deployedContracts={[deployedContractForSession(functionInputSession)]}
          stateSnapshot={{
            status: { status: "ready", message: "state loaded", hint: null },
            address: "0x000000000000000000000000000000000000c0fe",
            values: [],
            storageLayoutId: "layout:abc123",
            storageValues: [
              {
                id: "storage:numbers",
                kind: "array",
                name: "numbers",
                typeLabel: "uint256[]",
                summary: "len=4 [1, 2, 3, ...]",
                detailAvailable: true,
              },
            ],
          }}
          onStateDetailRequest={(request) => {
            requests.push(request);
            return {
              rowId: request.rowId,
              title: "numbers detail",
              lines: ["numbers[0] = 1", "numbers[3] = 4"],
              copyValue: "numbers[0] = 1\nnumbers[3] = 4",
            };
          }}
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
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    expect(requests).toHaveLength(1);
    expect(setup.captureCharFrame()).toContain("numbers[3] = 4");
  });

  test("build diagnostics render in a diagnostics panel", async () => {
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={functionInputSession}
          onBuildRequest={() => ({
            status: "error",
            message: "Foundry build failed.",
            diagnostics: [
              {
                severity: "error",
                message: "Expected identifier but got '}'",
                code: "ParserError",
                file: "src/Broken.sol",
                line: 12,
                column: 3,
                source: "forge build",
              },
            ],
            stdout: "",
            stderr: "ParserError: Expected identifier but got '}'",
          })}
        />
      ),
      {
        width: 104,
        height: 30,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressKey("b");
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Diagnostics");
    expect(frame).toContain("ParserError");
    expect(frame).toContain("src/Broken.sol:12:3");
    expect(frame).toContain("Expected identifier");
  });

  test("renders direct read submission errors in the feed", async () => {
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={tokenSession}
          deployedContracts={[deployedContractForSession(tokenSession)]}
          onFunctionInputSubmit={() => {
            throw new Error("No deployment found for Token on local.");
          }}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("No deployment found");
    expect(frame).toContain("Token on");
    expect(frame).toContain("local.");
  });

  test("read function input with args hides the value field", async () => {
    const balanceSession = {
      ...tokenSession,
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
    } as const;
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={balanceSession}
          deployedContracts={[deployedContractForSession(balanceSession)]}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Function input");
    expect(frame).toContain("args: owner:address");
    expect(frame).toContain("Tab params");
    expect(frame).toContain("history");
    expect(frame).toContain("Ctrl+U clear");
    expect(frame).not.toContain("value:");
  });

  test("updates the active dev session after selecting a source file", async () => {
    const selected: string[] = [];
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={functionInputSession}
          onSourceFileSelect={({ target }) => {
            selected.push(target);
            return tokenSession;
          }}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressKey("f");
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await setup.flush();

    expect(selected).toEqual(["src/Token.sol:Token"]);
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Token");
    expect(frame).toContain("no deployed contract selected");
    expect(frame).not.toContain("symbol()");
  });

  test("keeps the TUI alive when selecting a source file fails", async () => {
    const setup = await testRender(
      () => (
        <DevShellController
          locale="en-US"
          session={functionInputSession}
          onSourceFileSelect={() => {
            throw new Error("artifact missing for selected contract");
          }}
        />
      ),
      {
        width: 92,
        height: 26,
        useMouse: true,
      },
    );
    await setup.flush();

    setup.mockInput.pressKey("f");
    await setup.renderOnce();
    setup.mockInput.pressArrow("down");
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("artifact missing for selected");
    expect(frame).toContain("contract");
    expect(frame).toContain("Compile & Deploy");
  });
});
