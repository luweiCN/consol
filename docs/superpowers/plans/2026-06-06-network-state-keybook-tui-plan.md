# Network State, Keybook, and TUI Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add local-chain state actions, move State Key Book persistence to a global network-scoped store, keep deployed-contract choices aligned with the active network and live chain code, add unit-input hints, and fix horizontal resize behavior in the dev TUI.

**Architecture:** Keep Foundry process/RPC details in `packages/foundry`, command orchestration in `packages/cli`, persistence helpers in `packages/core`, and rendering/focus/modal behavior in `packages/tui`. Keybook scoping is intentionally simple: local Anvil-like networks share one global `local` key bucket, while remote networks use network fingerprint plus chain id. Deployed contracts remain project deployment records but are filtered for the current network and validated against live code.

**Tech Stack:** TypeScript, Bun, OpenTUI/Solid, Foundry `anvil`/`cast`, ConSol JSON persistence helpers.

---

### Task 1: Horizontal TUI Layout Regression

**Files:**
- Modify: `packages/tui/src/DevShell.test.tsx`
- Modify: `packages/tui/src/DevShell.tsx`

- [x] **Step 1: Write failing resize test**

Add a test near the existing resize test that renders a real contract session with a deployed contract and feed, resizes from wide to narrow and back to wide, then asserts that Compile & Deploy, State, and Activity are all visible and that Contract still owns usable vertical space.

- [x] **Step 2: Run the focused test**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" bun test packages/tui/src/DevShell.test.tsx --test-name-pattern "resize"
```

Expected before implementation: the new test fails or reproduces missing/overlapped Activity after width restoration.

- [x] **Step 3: Fix row width allocation**

Change the dev-tab horizontal layout so the left Contract panel and right State/Activity stack use explicit width constraints in wide mode instead of `flexGrow` plus a sibling `50%` width. The Contract panel should retain a bounded width and full height; the right stack should get the remaining width and full height. In narrow mode, stack panels vertically as today.

- [x] **Step 4: Verify resize tests**

Run the same focused resize test command and confirm it passes.

### Task 2: Unit Input Hints

**Files:**
- Modify: `packages/tui/src/FunctionInputModal.tsx`
- Modify: `packages/tui/src/FunctionInputModal.test.tsx` or `packages/tui/src/DevShell.test.tsx`
- Modify: `packages/i18n/src/locales/en-US.ts`
- Modify: `packages/i18n/src/locales/zh-CN.ts`

- [x] **Step 1: Write failing placeholder test**

Add a test that opens a function input modal for `setNumber(uint256)` and verifies the argument placeholder includes examples `1`, `1ether`, `0.5ether`, and `100gwei`. Add a payable value-field assertion if an existing payable fixture is available.

- [x] **Step 2: Run the focused test**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" bun test packages/tui/src/FunctionInputModal.test.tsx packages/tui/src/DevShell.test.tsx --test-name-pattern "unit|uint256|placeholder"
```

Expected before implementation: missing unit examples.

- [x] **Step 3: Implement hint-only behavior**

Add a helper that detects `uint*` input kinds and returns the unit-example placeholder. Do not transform input values. For payable `value`, use the same unit examples in the value placeholder.

- [x] **Step 4: Verify hint tests**

Run the same focused test command and confirm it passes.

### Task 3: Global Network-Scoped State Key Book

**Files:**
- Modify: `packages/core/src/project/state-key-book.ts`
- Modify: `packages/core/src/project/storage-state.test.ts`
- Modify: `packages/cli/src/commands/dev.ts`
- Modify: `docs/product/DEV_TUI_COMPLEX_STATE_PANEL.md`

- [x] **Step 1: Write failing persistence tests**

Add tests that save/read keybook entries under a global config path instead of `projectRoot/.consol/state-keys.json`. Test local network scope resolves to a shared `local` bucket. Test remote scope includes network fingerprint and chain id.

- [x] **Step 2: Run keybook tests**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" bun test packages/core/src/project/storage-state.test.ts packages/cli/src/main.test.ts --test-name-pattern "Key Book|state key"
```

Expected before implementation: reads/writes still use project-local `.consol/state-keys.json`.

- [x] **Step 3: Implement global path and scope**

Add a `StateKeyBookScope` helper:

```text
local/anvil/anvil-fork -> local
remote -> <network fingerprint or name>:<chain id or unknown>
```

Use `~/.config/consol/state-keys.json` through the existing config-path environment helpers. Do not fallback to project-local keybooks.

- [x] **Step 4: Wire CLI dev state reads/writes**

Pass active network metadata into state keybook reads/writes from `packages/cli/src/commands/dev.ts`, including row-detail storage snapshots and keybook changes.

- [x] **Step 5: Verify keybook tests**

Run the same focused test command and confirm it passes.

### Task 4: Deployed Contract Filtering and Live Code Validation

**Files:**
- Modify: `packages/cli/src/commands/deploy-cache.ts`
- Modify: `packages/cli/src/commands/dev.ts`
- Modify: `packages/cli/src/main.test.ts`
- Modify: `packages/tui/src/DevShellController.tsx` if merge keys need network fingerprint preservation

- [x] **Step 1: Write failing dev snapshot tests**

Add tests that create deployment cache entries for local and remote networks and assert `consol --json dev` / deployed-contract snapshot includes only entries matching the active network. Add a stale local entry with no live code and assert it is excluded from the deployed selector snapshot.

- [x] **Step 2: Run focused dev snapshot tests**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" bun test packages/cli/src/main.test.ts --test-name-pattern "deployed contract|deployment cache|stale"
```

Expected before implementation: stale or wrong-network entries appear in the snapshot.

- [x] **Step 3: Filter by current network**

Filter deployment entries by active network fingerprint/name/chain id before converting to `DevDeployedContract`. Preserve `networkFingerprint` in the TUI runtime type.

- [x] **Step 4: Validate live code**

For deployed-contract snapshots, call `cast code` for candidate addresses on the active RPC and exclude entries with empty code. Keep explicit stale error behavior for direct interaction paths.

- [x] **Step 5: Verify deployed-contract tests**

Run the same focused test command and confirm it passes.

### Task 5: Local Chain State Actions

**Files:**
- Modify: `packages/foundry/src/commands.ts` or create `packages/foundry/src/anvil-state.ts`
- Modify: `packages/cli/src/commands/chain.ts`
- Modify: `packages/cli/src/main.test.ts`
- Modify: `packages/tui/src/dev-selector-actions.ts`
- Modify: `packages/tui/src/DevSelectorLayer.tsx`
- Modify: `packages/tui/src/DevShell.tsx`
- Modify: `packages/tui/src/DevShellController.tsx`
- Modify: `packages/i18n/src/locales/en-US.ts`
- Modify: `packages/i18n/src/locales/zh-CN.ts`

- [x] **Step 1: Write failing chain command tests**

Add JSON command tests for `chain state save <name>`, `chain state list`, `chain state restore <id-or-name>`, and `chain reset`. Scope these commands to local `anvil` / `anvil-fork`; remote networks must return `remote_chain_lifecycle_unsupported`.

- [x] **Step 2: Run focused chain tests**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" bun test packages/cli/src/main.test.ts --test-name-pattern "chain state|chain reset"
```

Expected before implementation: unsupported command errors.

- [x] **Step 3: Implement Anvil state RPC helpers**

Add helpers for `anvil_dumpState` and `anvil_loadState` using `cast rpc` or direct RPC in the foundry/CLI adapter layer. Store snapshot files and metadata under the ConSol cache/config directory with private permissions.

- [x] **Step 4: Implement chain commands**

Implement:

```text
consol chain reset
consol chain state save <name>
consol chain state list
consol chain state restore <id-or-name>
```

Reset stops managed Anvil and starts a clean chain without loading saved state. Save requires a running local chain. Restore starts local chain if needed, then loads the selected dump.

- [x] **Step 5: Add network picker actions**

Extend selector actions so network picker rows for local networks show Start chain, Save state, Restore state, and Reset chain. Remote rows do not show these actions. Save opens a naming modal. Restore opens a state snapshot picker.

- [x] **Step 6: Refresh TUI after chain actions**

After reset/restore/start, refresh deployed contracts, state snapshot, events, transactions, and block/event watchers. Clear active deployed contract when reset leaves no valid deployed contracts. Do not clear build diagnostics/artifact state.

- [x] **Step 7: Verify chain and TUI action tests**

Run focused chain tests and selector-action tests.

### Task 6: Final Verification

**Files:**
- Verify all touched packages.

- [x] **Step 1: Run focused test groups**

Run all focused commands from Tasks 1-5.

- [x] **Step 2: Run package gate**

Run:

```bash
PATH="/opt/homebrew/bin:$PATH" bun run typecheck
PATH="/opt/homebrew/bin:$PATH" bun test
PATH="/opt/homebrew/bin:$PATH" bun run release:check
git diff --check
```

- [x] **Step 3: Summarize residual risk**

Report any skipped test, environmental limitation, or behavior deliberately left out, especially project-local keybook migration and `Restart` action.
