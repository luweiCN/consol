# ConSol CLI Spec

## 1. Command Name

Binary name: `consol`

Brand name: `ConSol`

Slogan: `ConSol — the smart contract console.`

## 2. Global Flags

```bash
consol <command> [args...] [flags]
```

Common flags:

- `--json`：输出 JSON envelope。
- `--ndjson`：watch/stream 命令输出 NDJSON。
- `--profile <name>`：选择 `consol.toml` profile。
- `--network <name>`：选择 named network profile。
- `--rpc-url <url>`：临时覆盖 RPC URL。
- `--chain-id <id>`：expected-chain guard，不是盲目覆盖。
- `--account <name|address|index>`：选择账户。
- `--signer <name>`：选择签名来源。
- `--project <path>`：指定项目根目录。
- `--yes`：跳过本地/dev 网络确认；远程网络默认仍需要更强确认策略。
- `--no-color`：禁用彩色输出。
- `-v`, `-vv`, `-vvv`：增加日志详细程度。

## 3. Command Groups

### Target Grammar

Most commands accept `<target>` instead of only `<contract>`:

```text
Counter                         # Foundry project artifact contract name
./Counter.sol                   # single-file mode, valid if only one deployable contract
./Counter.sol:Counter           # single-file mode with explicit contract
./lesson/ERC20Demo.sol:MyToken  # single-file demo path with explicit contract
```

If a target is ambiguous, ConSol must fail with `target_ambiguous` and list candidates.

Single-file mode creates a scratch Foundry project under `~/.cache/consol/scratch/<hash>`. The scratch project copies the entry `.sol` file plus local Solidity imports that stay under the entry file's directory tree, preserving relative paths such as `./lib/Math.sol`. Package/remapping imports are left to Foundry and should move to a real project when the demo needs external dependencies. Imports that escape the entry directory with `../` fail with `single_file_import_outside_root` instead of silently copying unrelated files.

### Project

```bash
consol init
consol init --from-file <file.sol> --to <dir>
consol detect
consol detect [target]
consol build
consol build [target]
consol test
consol snapshot
```

`init` creates a minimal Foundry-compatible project. With `--from-file`, ConSol copies the Solidity source into `src/` and writes `foundry.toml`; without `--from-file`, it creates a small sample `Counter.sol`. It refuses to overwrite an existing `foundry.toml` or existing destination source file.

`test` wraps `forge test --root <project>` and returns the same JSON envelope shape as `build`, including status, stdout, and stderr.

`abi <target>` reads the resolved artifact and prints the raw ABI. With `--json`, the ABI is wrapped with target, contract, source mode, project root, and artifact path metadata.

`build --json` includes a `diagnostics` array parsed from `forge build` / solc output. Each diagnostic contains `severity`, `message`, optional `code`, optional `file` / `line` / `column`, and `source`. This is the first stable diagnostics payload for TUI panels and future editor integrations.

`detect` 必须返回：

- project root
- foundry.toml path
- forge/cast/anvil availability and versions
- active RPC
- chain id if reachable
- account source
- artifact output directory
- source mode: `project` or `single_file`
- scratch project path if single-file mode is active

`snapshot` is the TUI-friendly aggregate state:

- project/source mode
- active network/account/signer
- build status and diagnostics
- contracts with file identity
- deployment states
- recent history
- active watches

### Inspect

```bash
consol inspect <target>
consol abi <target>
consol storage <target>
```

`inspect` 是面向人类和 TUI 的聚合命令，包含：

- source file
- artifact path
- ABI summary
- functions/events/errors
- public getters
- bytecode hash
- deployment status if known
- compiler gas estimates if available

`abi` 是更低层命令，主要给插件和脚本读取 ABI。

`storage <target>` builds the resolved target, runs `forge inspect <contract> storage-layout --json`, and returns slot, offset, source contract, type id, type label, encoding, byte width, plus the raw `types` map. This is the base payload for future TUI storage views and trace analysis.

### Network

```bash
consol network list
consol network add <name> --rpc-url <url>|--rpc-url-env <ENV> --chain-id <id> [--write-policy confirm|typed-confirm|read-only]
consol network add <name> --fork-url <url>|--fork-url-env <ENV> [--fork-block-number <block>] [--chain-id <local-chain-id>]
consol network use <name>
consol network status [name]
consol network remove <name>
```

Network model:

- `name`: stable profile name, for example `local`, `sepolia`, `mainnet-fork`.
- `kind`: `anvil`, `remote`, `anvil-fork`, `custom`.
- `expected_chain_id`: chain-id guard.
- `fingerprint`: chain id plus RPC/fork/genesis identity where available.
- `write_policy`: `local`, `confirm`, `typed-confirm`, `read-only`.

Network profile rules:

- Built-in `local` always exists and points to `http://localhost:8545`.
- User profiles are stored in `~/.config/consol/config.toml`, or `CONSOL_CONFIG` when set.
- Config and local `.consol/*.json` state files are written as private local state on Unix-like systems: parent directories use `0700` and files use `0600`.
- `consol network add` stores a profile but does not automatically switch to it.
- `consol network use <name>` persists the active profile.
- `consol network add` accepts `--write-policy`; if omitted, local Anvil uses `local`, Ethereum mainnet chain id `1` uses `typed-confirm`, and other remote networks use `confirm`.
- `consol network add <name> --fork-url-env MAINNET_RPC_URL --fork-block-number <block>` creates an `anvil-fork` profile. The profile listens on the local Anvil RPC by default, uses write policy `local`, and passes the fork source to `anvil --fork-url` when `consol chain start` / `restart` manages it.
- `--rpc-url <url>` is a one-command override and does not mutate config.
- `ETH_RPC_URL` is treated as a one-command environment override when `--rpc-url` is not set.
- `--rpc-url-env <ENV>` profiles may be added before `ENV` is set; commands that need the profile fail clearly if the env var is missing.
- `--fork-url-env <ENV>` fork profiles may also be added before `ENV` is set; commands that need to resolve or start the fork fail with a fork-specific missing-env error.
- JSON and human output redact remote RPC paths, query strings, and userinfo by default so provider API keys are not printed. Localhost RPC URLs remain visible for debugging.

Switching network must re-check cached deployments. It must not silently switch account/signer.

### Account / Signer

```bash
consol account list
consol account use <name|address|index>
consol account import <name> --private-key-env <ENV>
consol account import <name> --keystore <ACCOUNT> [--keystore-dir <dir>] --password-env <ENV>
consol account balance [name|address]
consol signer list
consol signer status [name]
```

Signer sources:

- `anvil-index`
- `env-private-key`
- `keystore`
- `browser-wallet` (later)
- `walletconnect` (later)
- `hardware-wallet` (later)
- `kms` (later)

Selecting an account must not silently switch network. Read-only commands can run without a signer; deploy/send require one.

Account profile rules:

- Built-in `anvil0` is available only as a local/dev signer and must not be used for remote writes.
- `ETH_PRIVATE_KEY` creates a temporary `env` signer when set.
- `consol account import <name> --private-key-env <ENV>` stores only the env var name, never the private key value.
- `consol account import <name> --keystore <ACCOUNT> --password-env <ENV>` stores the Foundry keystore account name, optional keystore directory, and password env var name. ConSol decrypts through `cast wallet decrypt-keystore` only when a write needs the signer.
- `consol account use <name>` persists the active account profile.
- `consol signer list` returns the signer registry keyed by account profile name. Each item includes source, account, address, active flag, and availability.
- `consol signer status [name]` returns the active signer when `name` is omitted, or a named signer profile when provided.
- `--signer <name>` temporarily selects a signer-backed account profile for the current command without persisting `active_account`. If `--account` is omitted, it also becomes the account context shown in `detect`, `signer status`, transaction previews, and JSON/NDJSON metadata.
- If both `--account` and `--signer` are provided in the current implementation, they must reference the same profile name. Fully independent account-address and external-signer selection is reserved for the later external signer model.
- Unknown account selectors fail before cache lookup, private-key env access, or keystore decrypt, instead of falling back to `ETH_PRIVATE_KEY` or a real `--signer` profile.
- `deploy` and `send` refuse remote writes unless an explicit env-backed signer, keystore signer, or `ETH_PRIVATE_KEY` is selected.

### Chain

```bash
consol chain start
consol chain stop
consol chain restart
consol chain status
```

`chain` controls local `anvil` and named `anvil-fork` profiles. Remote RPC connection and switching belongs to `network`.

### Deployment

```bash
consol deploy <target> [constructor_args...]
consol deploy --list
consol deploy --all
consol deploy --forget <target>
```

`deploy --all` builds the active Foundry project, discovers deployable artifacts from `src/`, emits a deployment plan, and sequentially deploys zero-argument constructors. Contracts with constructor inputs, non-deployable bytecode, duplicate contract names, or unsupported source locations are reported as skipped plan items instead of being silently ignored. `deploy --list` reads the local deployment cache newest first, and `deploy --forget <target>` removes cached entries for a contract.

部署缓存 key：

```text
workspace_id + contract_name + creation_bytecode_hash + constructor_args_hash + network_fingerprint + deployer
```

缓存命中后必须用 `cast code <address>` 验证链上地址仍有代码。

Deploy flow:

1. resolve target
2. build if artifact is stale
3. compute bytecode and constructor args hash
4. check cache and validate chain code
5. estimate gas where possible
6. show confirmation for writes
7. sign and broadcast
8. persist deployment and history

### Interaction

```bash
consol call <target> <function> [args...]
consol send <target> <function> [args...] [--value <amount>]
consol state <target>
consol state <target> --watch
consol logs <target>
consol logs <target> --watch
consol activity <target> [--limit <n>]
consol tx list [target] [--limit <n>]
```

Rules:

- `call` 默认只允许 view/pure 函数；如果 ABI 显示为 nonpayable/payable，应提示改用 `send`。
- `send` 必须显示交易摘要；`--yes` 默认只跳过 local/dev 网络确认。
- `state` 第一版只读取无参数 view/pure 函数和 public getter。
- `state --watch` streams repeated state snapshots; use `--ndjson` for machine-readable event lines.
- `logs` 使用 ABI 解码事件。
- `logs --watch` streams decoded contract events; use `--ndjson` for machine-readable event lines.
- `activity` returns the combined deployment, state, decoded event, and transaction snapshot used by the `Activity` visual surface. TUI panels may add short-lived session events on top, but durable contract activity must come from this command/data layer.
- overloaded functions must be selected by full signature when ambiguous.
- write commands should perform simulation/gas estimation when possible and classify failures.
- successful `deploy` and `send` calls append `.consol/transactions.json` when a transaction hash is available. Records include action, contract, target/address/function context, tx hash, receipt summary when available, network/chain/account identity, and timestamp.
- `tx list` reads local transaction history newest first and can filter by target. `snapshot.recent_history` exposes the same history for TUI/editor consumers.

### Interactive

```bash
consol dev [target]
consol console <target>
consol demo <target> [constructor_args...]
```

`dev` 是 TUI cockpit。

`console` 是合约上下文 REPL，适合快速调试和教学。

The first `console` implementation supports `state`, `logs`, `call <function|signature> [args...]`, `send <function|signature> [args...] [--value <amount>]`, `help`, and `exit`. `consol --json console <target>` returns the REPL context without entering interactive mode.

`demo` is the single-file teaching shortcut: resolve file, create scratch project, build, start local chain if needed, deploy, then print next commands or enter console. It supports constructor args and local import graphs under the entry file's directory tree, and returns a JSON summary with deployment address and suggested follow-up commands.

The first `dev` implementation is a terminal cockpit shell: it opens an alternate-screen TUI, shows target/project/network/account/tool status, lists immediate CLI workflows, and supports `r` refresh plus `q`/`Esc` quit. `consol --json dev [target]` returns the same initial cockpit state for editor integrations and smoke tests without entering full-screen mode.

The current `dev` TUI is current-contract-first instead of source-tree-first. `consol dev` scans Solidity sources under `src`, `contracts`, `test`, `script`, plus root-level single-file demos, then binds the workspace to the selected file/contract. A single discovered contract is selected automatically; multiple discovered contracts are chosen through a centered fuzzy contract picker opened with `/`. The workspace tabs are `Overview`, `State`, `Events`, `Contract`, `Build`, `Activity`, and `Help`. `State` reuses the same zero-argument reader snapshot used by `consol state`; `Events` reuses the ABI decoded event snapshot used by `consol logs`; `Contract` reads ABI items from the built artifact and shows constructor/read/write/payable actions with explicit next-step guidance. Missing build/deployment state is reported inside the panels instead of aborting the cockpit.

The source-first explorer makes bare `consol dev` useful before a project has artifacts: it scans Solidity files under `src`, `contracts`, `test`, `script`, plus root-level single-file demos, identifies contract/library/interface declarations, exposes a `source_explorer` payload in `consol --json dev`, and selects the first deployable contract when no target was provided. In a Foundry project it still scans `out/` artifacts for deployed/ABI-backed switching and lets TUI users cycle artifact contracts with `[` / `]`. In a directory with only `Counter.sol`, bare `consol dev` resolves the file through the single-file scratch-project flow and enters the same TUI model.

The contract picker supports typed fuzzy search across source path, contract name, declaration kind, and directory category. Plain letters always edit the query, including `j` and `k`; arrow keys move the highlighted match, `Enter` switches the whole TUI context to that contract, and `Esc` closes the picker. Build, deploy, state, events, functions, activity, and history then all follow the newly selected contract, matching the Remix model where the active file/contract drives the surrounding tools.

The `Contract` workspace is the primary run surface. On wide terminals it splits into the ABI function list, a persistent State Watch, and a persistent Activity panel. Short and narrow terminals collapse those sections into a vertical/compact layout without requiring users to leave the current contract flow. The terminal UI follows a lazygit/lazydocker-style cockpit model: a compact context/status strip at the top of the workspace, a single focused runnable ABI list in the center, selected-row emphasis, selected-function details only for the active row, and a bottom keybar for the current command flow. When a source file contains multiple contract/interface/library declarations, the selected target still drives the whole workspace, while the Contract panel shows the sibling declarations from the same file and marks the active one; switching between them is done through `/`. State Watch auto-reads no-argument `view` / `pure` functions and public getters after deployment, renders decoded readable values plus raw ABI data in a compact `name / type / value` table, refreshes immediately after ConSol-owned writes, and uses 5-second polling or manual `r` refresh for external writes that happen outside the current TUI. It is not event-subscription driven yet. The State Watch view is a visualization of the same `state` section returned by `consol activity <target>` and the same reader model used by `consol state <target>`.

The Activity layer records TUI actions, read call results, low-frequency live refresh changes, and recent local transaction history. Durable contract data comes from `consol activity <target>`, which combines deployment cache state, the `consol state` reader snapshot, the `consol logs` decoded event snapshot, and the same `.consol/transactions.json` records exposed by `consol tx list`. The Activity workspace and the compact Activity panel inside `Contract` show the same activity model plus short-lived TUI session messages such as read results, manual refresh notices, and auto-refresh notices. The compact activity view uses `tx`, `event`, and `session` prefixes and count headers so repeated reads/refreshes remain visible instead of feeling swallowed. It renders oldest-to-newest from top to bottom, follows the latest entries when new logs arrive, and supports PageUp/PageDown plus mouse wheel scrolling back to older entries with a right-side scrollbar and inline range indicator. Pressing `t` in the Activity panel traces the latest recorded transaction hash on the active matching network and renders receipt metadata plus the first trace lines inline. The auto-refresh tick compares deployment/state/event summaries for the selected target and appends a specific activity event such as `state/activity updated` or `activity updated` when live data changes.

The first action inside `dev` is the action sheet layer: press `b` to build and refresh ABI/functions, press `d` to deploy the open target, or select the constructor row in `Contract` and press `Enter`. Constructor inputs open the same ABI argument sheet and then a deployment preview. When the `Contract` workspace is active, Up/Down move the selected ABI item and `Enter` or `c` opens the relevant function action. Constructors are shown as a deploy category. `view` / `pure` functions are `read`; `nonpayable` functions are `write`; `payable` functions are `payable` and prompt for `value` before function args. The argument sheet shows input syntax, not semantic sample data: top-level arguments are separated with spaces, strings only need quotes when they contain spaces, integer values can be typed as normal decimal or `0x` hex without 256-bit zero-padding, arrays use cast-style `[v1,v2]`, and structs/tuples use `(v1,v2)` in ABI field order. Arrays and tuples are kept as a single token, so users should not add spaces after commas unless the space is inside a quoted string value. Read/write/payable function args are checked with `cast calldata` before call/send preview; constructor args are checked with `cast abi-encode constructor(...)` before deployment preview. Invalid count, quoting, numeric, array, or tuple input keeps the sheet open and shows the cast error plus the generic ABI syntax rules. If a non-constructor function is selected before the contract has an active deployment, ConSol opens the deployment args/preview flow first and explains that the function can run after deployment. Function/constructor input text is cached per `target + action + signature` for the current TUI session, so rerunning the same function restores the previous args while other functions start with their own cached args or a blank input. Zero-argument reads execute immediately after deployment. Local write functions show a transaction preview with network, chain id, account, signer, target address, value, function args, gas estimate when available, nonce/gas price when available, calldata prefix/hash, and an `Enter` / `y` confirmation before broadcasting. After deploy/write, the TUI returns to `Contract` and refreshes state so the next read/write step is visible. Remote deploy/write actions reuse the same write policy model as the CLI: `read-only` is blocked, `confirm` requires typing `yes` in the TUI, and `typed-confirm` requires typing the active network name. The TUI rechecks network, chain id, write policy, account, target address, and signer before broadcasting so a stale preview cannot silently send on a changed context.

The profile-switching layer adds `n` and `a` in `dev`. `n` cycles configured network profiles, persists the active profile, and reloads deployment/state/event panels so stale addresses are not assumed across chains. `a` cycles `anvil0`, `env` when available, and imported account profiles without changing the active network. Both actions are disabled when the session was launched with explicit global overrides such as `--network`, `--rpc-url`, `ETH_RPC_URL`, `--account`, or `--signer`.

The CLI equivalence layer is an architecture boundary, not only help text. Every durable panel capability should map to a CLI command/data model: `Build` to `consol build`, State Watch to `consol state` / `consol activity.state`, Activity rows to `consol activity`, decoded events to `consol logs`, transaction history to `consol tx list`, and transaction traces to `consol trace`. The `Help` workspace explains the primary Contract workflow and shows CLI equivalents. `Enter` can still run TUI-native shortcuts for `build`, `deploy`, `state`, `logs`, `activity`, and `tx list`, while `y` copies the equivalent CLI command when a terminal clipboard backend is available. CLI-only actions such as `inspect`, `gas`, and `console` are copied with a visible status message instead of pretending to run inside the TUI.

The `Build` workspace is build-driven: press `b` in `consol dev` to run `consol build`. A clean build returns to `Contract` with refreshed ABI/functions; a build with diagnostics opens `Build` and renders parsed compiler diagnostics with severity, code, message, and file location.

The TUI text layer uses locale files under `apps/cli/locales` and the internal `t` / `tf` helpers. `CONSOL_LANG`, `LANGUAGE`, `LC_ALL`, `LC_MESSAGES`, or `LANG` can select a locale. The first migrated surface is the `consol dev` picker, confirmation sheets, State Watch, and Activity; the remaining CLI/TUI strings should move behind the same keys as those panels stabilize.

### Gas

```bash
consol gas compile <target>
consol gas estimate <target> <function> [args...] [--value <amount>]
consol gas report
consol gas snapshot
```

`gas compile` reads Foundry compiler estimates via `forge inspect gasEstimates` and returns creation plus external function estimates. This is the first structured data source for future editor ghost-text gas hints.

`gas estimate` simulates a deployed contract call with `cast estimate` and returns transaction gas without sending a transaction. It resolves the same target/deployment context as `call` and `send`, accepts the same function selector shape as `send`, supports `--value`, and uses the active account address as `--from` when known. It does not require reading a private key. `send` carries gas estimate failures into its transaction preview and JSON payload instead of silently dropping them.

Gas-producing JSON payloads include a structured signal alongside legacy scalar fields. The current signal shape is:

```json
{
  "kind": "compiler_estimate | rpc_estimate | unavailable",
  "source": "forge inspect gasEstimates | cast estimate | not_estimated",
  "confidence": "low | medium | none",
  "context": {
    "contract": "Counter",
    "function": "setNumber(uint256)",
    "network": "local",
    "from": "0xf39f..."
  },
  "estimate": "35800",
  "error": null
}
```

`gas report` wraps `forge test --gas-report` for the active Foundry project and supports `--match-contract`. `gas snapshot` wraps `forge snapshot`, including `--diff` and `--check`, and returns stdout/stderr plus a success/failed status for JSON consumers.

### Diagnostics

```bash
consol gas compile <target>
consol gas estimate <target> <function> [args...] [--value <amount>]
consol gas report [--match-contract <name>]
consol gas snapshot [--diff|--check]
consol analyze
consol hints --file <path> [--contract <name>]
consol activity <target> [--limit <n>]
consol tx list [target] [--limit <n>]
consol trace <tx_hash>
consol verify <target> [--address <address>] [--chain <chain>] [--verifier <name>]
```

`analyze` runs the project-level ConSol health check: `forge build` diagnostics plus `forge test`, normalized into findings for CI/editor consumption. Human mode exits non-zero when analysis fails; JSON mode returns status and findings.

`hints --file <path> [--contract <name>]` is the first editor protocol command. It resolves the file target, returns build diagnostics, structured compiler gas estimate signals, and best-effort source line numbers for function gas ghost text.

`trace <tx_hash>` resolves the active network, fetches the transaction receipt with `cast receipt --json`, then runs `cast run` with local artifact decoding. The first JSON payload returns receipt metadata plus raw trace text; later iterations will normalize call frames, storage changes, and source locations.

`verify` builds the target and wraps `forge verify-contract`. If `--address` is omitted, ConSol tries to use the active deployment cache. It supports chain/verifier options, constructor-arg options, `--watch`, and `--show-standard-json-input` for manual browser submission.

## 4. JSON Envelope

Successful result:

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "meta": {
    "version": "0.1.0",
    "command": "build",
    "project_root": "/path/to/project",
    "network": {
      "name": "local",
      "kind": "anvil",
      "chain_id": 31337,
      "fingerprint": "local-anvil:31337:genesis-0x..."
    },
    "account": {
      "name": "anvil0",
      "address": "0xf39F...",
      "signer": "anvil-index"
    }
  }
}
```

Failed result:

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "artifact_not_found",
    "message": "Contract Counter was not found in Foundry artifacts.",
    "hint": "Run `consol build` first, or check the contract name.",
    "details": {}
  },
  "meta": {
    "version": "0.1.0",
    "command": "inspect",
    "project_root": "/path/to/project"
  }
}
```

JSON mode still uses the process exit code. `ok: false` results must exit non-zero and should not also print a human error to stderr. This keeps scripts and CI from treating failed ConSol commands as successful while preserving machine-readable stdout.

Error shape:

- `code`：稳定机器码，给插件判断。
- `message`：人类可读错误。
- `hint`：下一步建议。
- `details`：结构化上下文。

Diagnostic shape:

```json
{
  "severity": "error",
  "file": "src/Counter.sol",
  "line": 12,
  "column": 5,
  "code": "solc_error",
  "message": "Identifier not found or not unique.",
  "source": "forge build",
  "hint": "Check the imported symbol or remapping."
}
```

Gas signal shape:

```json
{
  "kind": "rpc_estimate",
  "source": "eth_estimateGas",
  "value": "35800",
  "unit": "gas",
  "confidence": "estimate",
  "contract": "Counter",
  "function_signature": "setNumber(uint256)",
  "chain_id": 31337,
  "block": "18",
  "from": "0xf39F...",
  "to": "0x5FbD...",
  "generated_at": "2026-05-30T10:00:00Z"
}
```

Allowed gas `kind` values:

- `actual`
- `rpc_estimate`
- `compiler_estimate`
- `test_report`
- `snapshot_delta`

## 5. NDJSON Events

Watch mode and write transaction streams emit one event per line:

```json
{"type":"build.started","time":"2026-05-30T10:00:00Z"}
{"type":"build.finished","ok":true,"warnings":0}
{"type":"network.changed","name":"sepolia","chain_id":11155111}
{"type":"account.changed","name":"deployer","address":"0xabc..."}
{"type":"diagnostic","severity":"error","file":"src/Counter.sol","line":12,"column":5,"message":"..."}
{"type":"gas.estimate","kind":"rpc_estimate","value":"35800","source":"eth_estimateGas"}
{"type":"state.snapshot","contract":"Counter","values":{"number":"41"},"block":15}
{"type":"state.changed","contract":"Counter","name":"number","before":"41","after":"42","block":16}
{"type":"tx.confirmation_requested","contract":"Counter","function":"setNumber","network":"sepolia"}
{"type":"tx.confirmed","contract":"Counter","function":"setNumber"}
{"type":"tx.rejected","reason":"user_cancelled"}
{"type":"tx.sent","hash":"0xabc","contract":"Counter","function":"setNumber"}
{"type":"tx.mined","hash":"0xabc","status":"success","gas_used":"35800"}
{"type":"event","contract":"Counter","event":"NumberChanged","args":{"value":"42"}}
```

TUI 和编辑器插件应该优先消费 NDJSON，而不是解析人类输出。

Current deploy/send NDJSON writes emit `tx.preview`, `tx.sent`, and `tx.mined` when the transaction reaches those phases. Command failures in machine-output mode emit a final `error` event and return a non-zero process exit code.

## 6. Write Safety Rules

- `--chain-id` is an expected-chain guard. If RPC returns a different chain id, command must fail.
- `deploy` and `send` must preview transaction details before signing.
- Local/dev networks can allow `--yes`; remote networks require explicit confirmation unless policy allows automation.
- Mainnet should default to `typed-confirm` or `read-only`.
- Current implementation hardens this baseline by refusing bare `--yes` for non-`local` write policies. Human-mode `confirm` asks for `yes`; `typed-confirm` asks for the network name. Machine mode can pass `--confirm-network <name>` to approve exactly the active network name for JSON or NDJSON automation.
- `--confirm-network <name>` must fail if `<name>` does not exactly match the active network, must not be combined with remote `--yes`, must not bypass `read-only`, must require a chain-id guard, and must use a named network profile instead of ad-hoc `--rpc-url` / `ETH_RPC_URL` overrides.
- NDJSON deploy/send writes are allowed only through the same confirmation policy and emit the transaction lifecycle stream instead of a JSON envelope.
- Current implementation also validates that the selected private key resolves to the selected account address before broadcasting, and includes signer address, nonce, gas price, calldata prefix/hash, and structured gas provenance in send/deploy previews when available.
- Confirmation must include network, chain id, signer source, from, to/new contract, value, gas/fee estimate, function signature, decoded args, calldata prefix/hash.
- Rejected wallet/signature requests must produce `tx_rejected`, not a generic failure.

## 7. Single-file Mode

Single-file commands:

```bash
consol detect ./Counter.sol --json
consol build ./Counter.sol --json
consol inspect ./Counter.sol:Counter --json
consol deploy ./Counter.sol:Counter --json
consol call ./Counter.sol:Counter number --json
consol send ./Counter.sol:Counter setNumber 42 --json
consol state ./Counter.sol:Counter --json
consol console ./Counter.sol:Counter
consol dev ./Counter.sol:Counter
consol init --from-file ./Counter.sol --to ./counter-foundry
```

State rules:

- Scratch projects live under ConSol cache/state, not beside the source file.
- `workspace_id` is derived from canonical source path and source mode.
- `build_id` includes transitive source hash, compiler version, remappings, dependency lock, and Foundry profile.
- unresolved imports fail with `import_unresolved` and suggest `--remapping` or dependency installation.
- `consol cache list/prune` should exist by P1 for teaching/demo cleanup.

## 8. MVP Acceptance Commands

在 Foundry Counter 项目里，以下命令必须跑通：

```bash
consol detect --json
consol build --json
consol inspect Counter --json
consol chain start
consol chain status --json
consol network status --json
consol account list --json
consol deploy Counter --json
consol call Counter number --json
consol send Counter setNumber 42 --json --yes
consol state Counter --json
```

单文件 Counter 也必须跑通：

```bash
consol detect ./Counter.sol --json
consol build ./Counter.sol --json
consol inspect ./Counter.sol:Counter --json
consol deploy ./Counter.sol:Counter --json --yes
consol call ./Counter.sol:Counter number --json
```

这些命令构成第一轮端到端测试。
