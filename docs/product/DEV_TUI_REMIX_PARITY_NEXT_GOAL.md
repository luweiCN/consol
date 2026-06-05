# Dev TUI Remix Parity Next Goal

This document is the source of truth for the next goal-mode pass on the
TS/OpenTUI rewrite.

The product goal is to move `consol dev` from a source-only contract cockpit to
a Remix-style development workflow:

1. Select a Solidity file or target.
2. Compile and choose one deployable contract from that source/artifact set.
3. Deploy it zero or more times.
4. Interact with concrete deployed instances by address.
5. Use RPC-derived transaction, state, balance, and event data to debug the
   contract and frontend listener behavior.

ConSol is not an editor, so file selection remains the terminal equivalent of
Remix's active editor tab. File selection affects compile/deploy targets. It
must not erase deployed instances or decide which chain address is being
interacted with.

## Non-Goals

- Do not add Explorer API integration in this pass.
- Do not add WalletConnect, browser wallet bridges, proxy upgrade flows, or
  contract verification in this pass.
- Do not implement a full debugger.
- Do not split large files just to satisfy `check:size`; record the failure and
  keep product fixes surgical.

## P0: Interaction Correctness

### Panel Footer Hints

Every panel should have exactly one identity title in the top-left title area.
Bottom-right footer text should show panel-local shortcuts and hints, not a
repeated panel title.

Acceptance criteria:

- Contract panel footer shows contract-local actions such as source target
  movement, deploy, open deployed instance picker, and function activation.
- State panel footer shows refresh/read hints.
- Feed panel footer shows scroll hints.
- Transactions panel footer shows transaction selection/detail hints.
- Diagnostics panel footer shows diagnostics-local hints.
- Main content areas do not contain shortcut-only hint rows.

### Selector Opener Keys

Opening selectors with `a`, `n`, `/`, or `Ctrl+/` must not seed the opener key
into the search input.

Acceptance criteria:

- Pressing `a` opens the account selector with an empty query.
- Pressing `n` opens the network selector with an empty query.
- Pressing `/` opens the file picker with an empty query.
- Pressing `Ctrl+/` opens the deployed contract picker with an empty query.

### Pending And Mined Transaction Merge

One user action should create one transaction row. Pending and mined states
should update the same row instead of creating duplicate rows.

Acceptance criteria:

- Deploy pending row is replaced by the mined row when receipt data arrives.
- Send pending row is replaced by the mined row when receipt data arrives.
- Failed confirmations update the pending row to a failed row when a matching
  action id or tx hash exists.
- Feed may show lifecycle messages, but Transactions must not imply two
  separate transactions for one user action.

## P1: Deployed Instance Workflow

### Source Contracts Versus Deployed Contracts

The source contract list is for compile/deploy selection. The deployed contract
list is for chain interaction.

Acceptance criteria:

- A selected source file can expose multiple deployable contracts.
- Deploying a contract appends a deployed instance instead of replacing the
  previous one.
- Repeating deploy on the same contract creates multiple instances with
  separate addresses.
- Changing source file does not remove existing deployed instances.
- Deployed instances keep enough snapshot data to remain interactable when the
  source file is changed or renamed: address, ABI/functions, contract name,
  source target, network, chain id, account, deployment tx hash, constructor
  args, and creation timestamp.

### Deployed Contract Picker

`Ctrl+/` opens a picker for deployed instances. The file picker remains `/`.

Acceptance criteria:

- The deployed picker lists contract name, short address, network, account,
  status, and optional deployment tx hash.
- Selecting an instance makes it the active interaction target.
- The Contract panel renders functions for the active deployed instance when one
  is selected.
- The source deploy target remains visible as a separate compile/deploy section.
- Each deployed instance can be removed from the session list without deleting
  source files or deployment cache entries.

### Add Contract At Address

Users should be able to add an already deployed contract address when the
current source/artifact ABI is available.

Acceptance criteria:

- An Add Contract action prompts for address and contract/ABI selection.
- Adding an address costs no gas and creates a deployed instance.
- The instance is interactable through the same Read/Write/Payable UI as a
  freshly deployed instance.
- The UI warns users to trust the address and ABI mapping.

## P1: Account, Network, Gas, And Value UX

### Account And Network Selector Detail

Selectors should show enough runtime information to choose safely.

Acceptance criteria:

- Account rows show account name, signer source, short address, active status,
  and balance when available.
- Account balances refresh from the RPC watcher while the TUI is open.
- Network rows show name, chain id, RPC host/fingerprint, transport type,
  latest block when available, and active status.
- Remote polling is slower than local polling.

### Gas Limit, Value, And Estimate

Deploy and send flows should support Remix-style gas and value controls without
overwhelming the default path.

Acceptance criteria:

- Transaction preview shows gas mode `auto` by default.
- Users can override gas limit for deploy and send actions.
- Users can set transaction value for deploy constructors and payable
  functions.
- Non-payable functions warn or reject non-zero value.
- Value is reset after each transaction execution.
- Runtime `estimateGas` is shown in preview when available.
- Compile-time gas estimates are shown beside functions when artifact data
  includes them.

### Public Getter And State Reads

Solidity public variables appear in ABI as getter functions and should be
treated as read actions.

Acceptance criteria:

- Zero-argument public getters are shown as read actions and can be refreshed
  into State.
- Getter functions requiring arguments, such as mappings or arrays, are shown as
  read actions with input prompts.
- State refresh uses batching where possible.

## P2: Events As A Debugging Signal

Events are valuable because frontend and wallet integrations often listen to
contract events. ConSol should expose chain-level event emission so users can
compare what the chain emitted with what frontend listener code received.

### Decode Events From Transaction Receipts

Acceptance criteria:

- Receipt logs from ConSol deploy/send transactions are decoded with the active
  deployed instance ABI when possible.
- Transaction detail shows decoded events with event name, signature, argument
  names, indexed markers, values, block, tx hash, and log index.
- Decode failures fall back to raw topics/data instead of hiding the log.
- Feed shows a compact event summary after mined transactions.

### Live Event Watch

Acceptance criteria:

- `packages/rpc` exposes a `watchContractEvent` wrapper owned outside
  `packages/tui`.
- The CLI runtime watches the active deployed instance when possible.
- Watched events append to an Events view and refresh Feed/State/Transactions.
- HTTP-only RPCs use `getLogs`/block polling as a fallback.
- Events can be filtered by active deployed instance and event name.

### Events View

Acceptance criteria:

- Add an Events top-level tab or subview that lists recent events for the active
  deployed instance.
- Rows show time/block, contract name, short address, event name, decoded args,
  tx hash, and source (`receipt` or `watch`).
- The view supports selection and detail expansion.
- Empty state explains that events appear after transactions emit logs or live
  watches receive logs.

## P2: Low-Level Interaction

Low-level interaction is useful for receive/fallback/proxy-style contracts, but
it should not dominate the default UI.

Acceptance criteria:

- If a deployed contract has `receive()` or `fallback()`, show a low-level
  interaction action on the deployed instance.
- The action can send value, calldata, or both.
- The preview clearly warns when calldata/value do not match receive/fallback
  expectations.
- The transaction uses the same pending/mined lifecycle, gas/value controls, and
  event decoding path as normal send actions.

## Remix Features To Defer

These are useful but not part of this goal:

- Contract verification through Sourcify/Etherscan/Blockscout.
- Proxy deployment and upgrade helpers.
- Scenario recorder / replay.
- Full transaction debugger.
- WalletConnect/browser wallet signing.
- Explorer-backed account or address history.

## Required Verification

Run the focused tests added for this goal, then at minimum:

```bash
bun run typecheck
bun run lint
bun test packages/tui/src/DevShell.test.tsx packages/tui/src/DevShellController.test.tsx --timeout 15000
bun test packages/cli/src/main.test.ts --timeout 15000
bun test packages/rpc/src/rpc-adapter.test.ts --timeout 15000
bun run package:build
bun run package:smoke
git diff --check
```

`bun run check:size` is expected to fail while the TS/OpenTUI rewrite still has
large product files. Record the failing files instead of doing a broad split in
this pass.

Manual smoke:

```bash
/Users/luwei/code/ai/consol/.worktrees/ts-opentui-rewrite/dist/consol dev /Users/luwei/code/ai/consol/.worktrees/ts-opentui-rewrite/examples/manual
/Users/luwei/code/ai/consol/.worktrees/ts-opentui-rewrite/dist/consol dev /Users/luwei/code/ai/consol/.worktrees/ts-opentui-rewrite/examples/manual/ConSolFeatureDemo.sol
cd /Users/luwei/web3-learning/courses/solidity-30days/contracts
/Users/luwei/code/ai/consol/.worktrees/ts-opentui-rewrite/dist/consol dev
```
