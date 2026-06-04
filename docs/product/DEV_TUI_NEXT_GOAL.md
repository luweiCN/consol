# Dev TUI Next Goal Plan

This document captures the next goal-mode scope for the TS/OpenTUI rewrite after the current manual testing round.

The emphasis is still product behavior first: fix the visible interaction gaps, replace fragile Solidity text parsing, and move chain-watching data from repeated `cast` subprocess calls toward a proper RPC client layer.

## Current Deficiencies

### Solidity Declarations

Current behavior:

- `packages/core/src/project/solidity-declarations.ts` uses lightweight text parsing.
- It strips comments and strings, then recognizes `contract`, `abstract contract`, `interface`, and `library` declarations with a regular expression.
- It tracks source order and marks declarations as deployable or non-deployable.

Why this is not good enough:

- Text parsing is fragile for a Solidity language surface.
- It can drift as syntax evolves.
- It cannot safely support richer UI features such as declaration locations, inheritance display, symbols, nested source metadata, or precise diagnostics.

Target behavior:

- Replace regex declaration parsing with structured parsing.
- Prefer `tree-sitter-solidity` if it works reliably in Bun and in the compiled `dist/consol`.
- If the tree-sitter Solidity grammar or native packaging is not reliable, use a compiler/AST path from solc/Foundry instead.
- Do not keep regex as the long-term source of truth.

Acceptance criteria:

- Strings/comments containing words like `contract`, `constructor`, `interface`, or `library` do not create false declarations.
- `contract`, `abstract contract`, `interface`, and `library` are detected correctly.
- Source order is preserved.
- Deployable contracts are distinguished from non-deployable declarations.
- Parser behavior is verified before changing UI behavior.
- The compiled `dist/consol` can use the parser, not only the test runner.

## Multi-Contract Display

Current behavior:

- The Contract panel displays all declarations as tabs.
- Non-deployable declarations are colored as disabled/danger.
- The first deployable concrete contract is selected by default.

Target behavior:

- The main contract switcher should prioritize deployable, user-operable contracts.
- Interfaces, abstract contracts, and libraries should not compete visually with deployable contracts.
- Acceptable UI options:
  - Preferred: show deployable contracts as primary tabs, and show non-deployable declarations in a weaker secondary row such as `Declarations: 3 non-deployable`.
  - Also acceptable: hide non-deployable declarations from the main tabs and expose them only in file details.
- Deployment and redeployment actions must stay disabled for non-deployable declarations.

Acceptance criteria:

- Day 14 style files do not visually imply that interfaces or abstract contracts are deployable.
- `ConSolFeatureDemo.sol` defaults to `ConSolFeatureDemo`, while `ConSolSimpleCounter` remains switchable.
- If non-deployable declarations are shown, their styling is visually weaker than deployable tabs.

## RPC Watcher And Transactions

Direction:

- Use `viem` for the long-term Node/TUI RPC watcher layer.
- Do not use Wagmi React as the primary runtime dependency because this is a terminal app, not a browser React app.
- Keep `cast` for short-term command execution and Foundry-oriented operations while the watcher layer is introduced.

Confirmed viem capabilities to use:

- `getBalance`
- `watchBlockNumber`
- `watchContractEvent`
- `waitForTransactionReceipt`
- `getTransactionReceipt`
- `getTransaction`
- `getBlock`
- `getLogs`
- `multicall`

Watcher strategy:

- On TUI launch:
  - fetch network/account status once,
  - fetch balance once,
  - fetch deployment state,
  - read zero-argument view/pure functions, preferably batched.
- After deploy/send:
  - immediately add/update a pending transaction record,
  - wait for the receipt,
  - refresh balance, State, Transactions, and Feed when mined.
- If the RPC has WebSocket support:
  - subscribe to block updates and contract events.
- If the RPC is HTTP only:
  - poll block number,
  - use shorter polling for local chains, roughly 1s-2s,
  - use slower polling for remote chains such as Sepolia, roughly 8s-12s.
- When a watched contract event matches the active contract:
  - refresh Feed,
  - refresh Transactions,
  - refresh State.

Transactions enrichment:

- For every known tx hash, fetch and display:
  - transaction hash,
  - status,
  - block number,
  - confirmations when possible,
  - from,
  - to,
  - value,
  - nonce,
  - gas used,
  - gas limit,
  - gas price / max fee / priority fee when present,
  - input/calldata,
  - logs/events,
  - network,
  - account,
  - timestamp if block data is available.
- Local chain and remote chains should use the same RPC-derived field model where possible.
- Explorer APIs such as Etherscan or Blockscout are optional follow-ups for address history, not required for tx-hash-based details.

Wallet connection priority:

- Keep local signer, anvil account, keystore, and env-private-key flows as the primary development path.
- WalletConnect can be a later signer/provider feature using a QR code or URI.
- A browser companion bridge can be considered later for MetaMask extension style UX, but it is higher complexity.
- WalletConnect/browser bridge is not required for balance refresh, event watching, or tx receipt tracking.

Package boundary:

- TUI must not call viem directly.
- Add a small RPC adapter layer, preferably a new package such as `packages/rpc`, or a clearly isolated module owned outside `packages/tui`.
- `packages/core` owns normalized state types.
- `packages/cli` wires runtime watchers into TUI callbacks/events.
- `packages/tui` consumes snapshots and actions only.

## UI Interaction Fixes

### Transactions Panel

Current issue:

- Hints such as `Up/Down select` and `Enter details` should not live in the main content area.
- Bottom global shortcuts should not include shortcuts that are not active for the current top-level tab.

Target behavior:

- Each panel can have a footer line.
- The Transactions panel footer should show panel-local hints such as:
  - `↑/↓ select`
  - `Enter details`
  - `Esc close` inside modals only
- The bottom global shortcuts should only show shortcuts valid for the active top-level tab.

Acceptance criteria:

- Transactions content area contains transaction records only.
- Panel-local hints are in the panel footer.
- Bottom shortcut bar changes per top-level tab.

### Global Shortcut Copy

Required changes:

- `/` label should be `file picker` / `文件选择器`, not `contract`.
- `[ / ]` should be shown as two tab-switch keys, not `[ ]`.
- Dev tab global shortcuts should include only Dev commands.
- Transactions tab global shortcuts should include only Transactions commands.
- Diagnostics tab global shortcuts should include only Diagnostics commands.

### Network And Account Selectors

Current issue:

- Pressing `n` opens the network selector, but the selector input may receive the opener key `n`.
- Pressing `a` opens the account selector, but the selector input may receive the opener key `a`.

Target behavior:

- The opener key should open the selector without seeding the search input.
- Account selector rows should show:
  - account name,
  - signer source,
  - address or short address,
  - balance when the RPC watcher layer is available.
- Add a selector-local copy shortcut for the selected account address, for example `c copy address`.

Acceptance criteria:

- `n` opens the network selector with an empty search box.
- `a` opens the account selector with an empty search box.
- Account rows expose enough identity to distinguish wallets.
- Copy address shortcut works inside the account selector and is shown as a selector-local hint.

### Contract Panel Modules

Target behavior:

- `Select contract` / `选择合约` should be styled like a module heading, consistent with `Read`, `Write`, and `Payable`.
- Deployable contract tabs should remain primary.
- Non-deployable declarations should be weak or secondary.

Acceptance criteria:

- Module headings share theme colors.
- Contract selector does not look like plain body text.

### Panel Footer Title

Target behavior:

- Every panel should have a top-left title as it already does.
- Every panel should also support a bottom-right footer title.
- Panel-local hints can use the bottom-left or footer area, while the panel identity can sit bottom-right.

Implementation note:

- If OpenTUI supports footer/bottom-title rendering directly, use that.
- If not, implement a small shared panel wrapper that draws footer text consistently without leaking layout hacks into each panel.

Acceptance criteria:

- Contract, State, Feed, Transactions, and Diagnostics follow the same footer/title convention.
- Footer text does not overlap scrollbars or content.
- Scrollbars remain visually consistent.

## Recommended Execution Order

1. UI hint/footer cleanup
   - Move Transactions hints out of content.
   - Make bottom shortcut bar tab-aware.
   - Rename shortcut labels.
   - Fix selector opener key leakage.
   - Add colored `Select contract` heading.
   - Add bottom-right footer titles for panels.

2. Contract declaration UX cleanup
   - Show deployable contracts as primary tabs.
   - Move non-deployable declarations to weak secondary display or hide from primary tabs.

3. Structured Solidity parsing
   - Add parser abstraction and tests.
   - Verify `tree-sitter-solidity` in Bun and compiled dist.
   - If it fails, use solc/Foundry AST instead.
   - Remove regex as production parser.

4. RPC watcher foundation
   - Add viem dependency and isolated RPC adapter.
   - Read balance via viem.
   - Track block number.
   - Track tx receipt by hash.
   - Keep existing cast path as fallback during rollout.

5. Transactions enrichment
   - Fetch transaction, receipt, block, logs, and confirmations.
   - Normalize local and remote chain transaction fields.
   - Update Transactions detail modal/panel.

6. Event-driven state refresh
   - Watch contract events when possible.
   - Fallback to polling and `getLogs`.
   - Batch read functions with multicall.

## Verification For The Goal

Minimum verification before reporting done:

```bash
bun run typecheck
bun run lint
bun test packages/tui/src/DevShell.test.tsx packages/tui/src/DevShellController.test.tsx --timeout 15000
bun test packages/cli/src/main.test.ts -t "standalone Solidity directory|direct multi-contract|bare dev opens a file picker" --timeout 15000
bun run package:build
bun run package:smoke
```

Manual checks:

```bash
/Users/luwei/code/ai/consol/.worktrees/ts-opentui-rewrite/dist/consol dev /Users/luwei/code/ai/consol/.worktrees/ts-opentui-rewrite/examples/manual
/Users/luwei/code/ai/consol/.worktrees/ts-opentui-rewrite/dist/consol dev /Users/luwei/code/ai/consol/.worktrees/ts-opentui-rewrite/examples/manual/ConSolFeatureDemo.sol
/Users/luwei/code/ai/consol/.worktrees/ts-opentui-rewrite/dist/consol dev
```

The third command should be run from:

```bash
/Users/luwei/web3-learning/courses/solidity-30days/contracts
```

Known exception:

- `bun run check:size` is currently expected to fail because several files exceed the 350-line limit. Do not split large files only for this manual-testing goal unless the goal explicitly changes.

## Goal-Mode Starting Prompt

Use this as the next goal-mode prompt:

```text
继续 /Users/luwei/code/ai/consol/.worktrees/ts-opentui-rewrite 的 TS/OpenTUI rewrite。

请按 docs/product/DEV_TUI_NEXT_GOAL.md 执行下一轮目标：

1. 先做 UI hint/footer cleanup：
   - Transactions 的 ↑/↓/Enter 提示移出内容区，放到 panel footer。
   - 底部全局快捷键按当前 top-level tab 切换，只显示当前 tab 生效的快捷键。
   - `/` 改成 file picker / 文件选择器。
   - `[ / ]` 明确显示两个切换 Tab 快捷键。
   - `n`/`a` 打开 selector 时不要把 opener key 写进搜索框。
   - `Select contract` / `选择合约` 用和 Read/Write/Payable 一致的模块标题样式。
   - 每个 panel 支持 bottom-right footer title。

2. 再做多合约声明展示：
   - 主 tabs 优先只展示 deployable contracts。
   - interface / abstract / library 做弱展示或从主 tabs 隐藏。
   - 不可部署声明不能触发 deploy/redeploy。

3. 然后升级 Solidity declaration parser：
   - 不再长期依赖 regex。
   - 优先验证 tree-sitter-solidity 在 Bun 和 dist/consol 中是否可用。
   - 如果不可用，改用 solc/Foundry AST 路线。
   - 保证字符串/注释里的 contract/interface/library/constructor 不产生误识别。

4. 设计并落地 viem RPC watcher foundation：
   - 不直接在 TUI 里使用 viem。
   - 新增隔离 RPC adapter。
   - 用 viem public client 做 balance、block、receipt 基础刷新。
   - 保留 cast 作为短期 fallback。

当前仍是人工测试阶段，优先修真实 UI/交互 bug。最后再补更大范围测试和质量重构。
不要 revert 现有改动。
使用 apply_patch 修改文件。
完成前至少跑文档里的 verification 命令，并用 examples/manual 与 solidity-30days/contracts 做手测。
```
