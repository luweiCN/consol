/** @jsxImportSource @opentui/solid */
import { EventEmitter, setMaxListeners } from "node:events";
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createInitialDevState, devReducer, type DevSession } from "@consol/core";
import type { TxPreviewEvent } from "@consol/protocol";
import { DevShellRuntime } from "./index";

EventEmitter.defaultMaxListeners = 200;
setMaxListeners(200);

const session: DevSession = {
  target: "Counter",
  contract: "Counter",
  sourceMode: "project",
  projectRoot: "/tmp/project",
  sourceFile: "src/Counter.sol",
  sourceFiles: ["src/Counter.sol"],
  sourceTargets: [{ sourceFile: "src/Counter.sol", contract: "Counter", target: "src/Counter.sol:Counter" }],
  artifactPath: "/tmp/project/out/Counter.sol/Counter.json",
  abiSummary: {
    functions: 1,
    events: 0,
    errors: 0,
    constructor: false,
  },
  constructor: null,
  functions: [],
};

const previewEvent: TxPreviewEvent = {
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

describe("DevShellRuntime", () => {
  test("passes confirmed transaction previews to the runtime handler", async () => {
    const confirmed: string[] = [];
    const initialState = devReducer(createInitialDevState(), {
      type: "openDeployPreview",
      event: previewEvent,
    });
    const setup = await testRender(
      () => (
        <DevShellRuntime
          locale="en-US"
          session={session}
          initialState={initialState}
          onConfirmedTxPreview={(event) => {
            confirmed.push(event.id);
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

    expect(confirmed).toEqual(["preview-1"]);
  });
});
