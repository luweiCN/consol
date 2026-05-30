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
consol network add <name> --rpc-url <url>|--rpc-url-env <ENV> --chain-id <id>
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
- `consol network add` stores a profile but does not automatically switch to it.
- `consol network use <name>` persists the active profile.
- `--rpc-url <url>` is a one-command override and does not mutate config.
- `ETH_RPC_URL` is treated as a one-command environment override when `--rpc-url` is not set.
- `--rpc-url-env <ENV>` profiles may be added before `ENV` is set; commands that need the profile fail clearly if the env var is missing.

Switching network must re-check cached deployments. It must not silently switch account/signer.

### Account / Signer

```bash
consol account list
consol account use <name|address|index>
consol account import <name> --private-key-env <ENV>
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
- `consol account use <name>` persists the active account profile.
- `deploy` and `send` refuse remote writes unless an explicit env-backed signer is selected or `ETH_PRIVATE_KEY` is set.

### Chain

```bash
consol chain start
consol chain stop
consol chain restart
consol chain status
```

`chain` only controls local `anvil`. Remote RPC connection and switching belongs to `network`.

### Deployment

```bash
consol deploy <target> [constructor_args...]
consol deploy --list
consol deploy --all
consol deploy --forget <target>
```

MVP 只要求单合约部署。`--all` 属于 v0.4。

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
```

Rules:

- `call` 默认只允许 view/pure 函数；如果 ABI 显示为 nonpayable/payable，应提示改用 `send`。
- `send` 必须显示交易摘要；`--yes` 默认只跳过 local/dev 网络确认。
- `state` 第一版只读取无参数 view/pure 函数和 public getter。
- `state --watch` streams repeated state snapshots; use `--ndjson` for machine-readable event lines.
- `logs` 使用 ABI 解码事件。
- `logs --watch` streams decoded contract events; use `--ndjson` for machine-readable event lines.
- overloaded functions must be selected by full signature when ambiguous.
- write commands should perform simulation/gas estimation when possible and classify failures.

### Interactive

```bash
consol dev [target]
consol console <target>
consol demo <target> [constructor_args...]
```

`dev` 是 TUI cockpit。

`console` 是合约上下文 REPL，适合快速调试和教学。

The first `console` implementation supports `state`, `logs`, `call <function|signature> [args...]`, `send <function|signature> [args...] [--value <amount>]`, `help`, and `exit`. `consol --json console <target>` returns the REPL context without entering interactive mode.

`demo` is the single-file teaching shortcut: resolve file, create scratch project, build, start local chain if needed, deploy, then print next commands or enter console. The first implementation supports constructor args and returns a JSON summary with deployment address and suggested follow-up commands.

The first `dev` implementation is a terminal cockpit shell: it opens an alternate-screen TUI, shows target/project/network/account/tool status, lists immediate CLI workflows, and supports `r` refresh plus `q`/`Esc` quit. `consol --json dev [target]` returns the same initial cockpit state for editor integrations and smoke tests without entering full-screen mode.

The second `dev` iteration adds real tabs for `Status`, `State`, `Events`, `Functions`, `Diagnostics`, and `Commands`. `State` reuses the same zero-argument reader snapshot used by `consol state`; `Events` reuses the ABI decoded log snapshot used by `consol logs`; `Functions` reads ABI functions from the built artifact. The TUI supports `Tab` / `Shift-Tab` panel switching, `1-6` direct panel jumps, and refreshes all live panel data with `r`. Missing build/deployment state is reported inside the panels instead of aborting the cockpit.

The first action inside `dev` is the action sheet layer: press `d` to deploy the open target on a local network; constructor inputs open the same whitespace/quoted-string argument sheet and then a `y` / `n` deployment preview. When the `Functions` tab is active, `j/k` move the selected ABI function and `Enter` or `c` opens the relevant function action. Zero-argument reads execute immediately; read or write functions with inputs open an argument sheet. Local write functions show a transaction preview with target address, function args, gas estimate when available, and an explicit confirmation before broadcasting. Remote deploy/write actions are blocked in the TUI for now and direct users to `consol deploy` / `consol send`, which already enforce the stronger remote confirmation flow.

The profile-switching layer adds `n` and `a` in `dev`. `n` cycles configured network profiles, persists the active profile, and reloads deployment/state/event panels so stale addresses are not assumed across chains. `a` cycles `anvil0`, `env` when available, and imported account profiles without changing the active network. Both actions are disabled when the session was launched with explicit global overrides such as `--network`, `--rpc-url`, `ETH_RPC_URL`, `--account`, or `--signer`.

The first Diagnostics panel is build-driven: press `b` in `consol dev` to run `consol build`, switch to the `Diagnostics` tab, and render parsed compiler diagnostics with severity, code, message, and file location.

### Gas

```bash
consol gas compile <target>
consol gas estimate <target> <function> [args...] [--value <amount>]
consol gas report
consol gas snapshot
```

`gas compile` reads Foundry compiler estimates via `forge inspect gasEstimates` and returns creation plus external function estimates. This is the first structured data source for future editor ghost-text gas hints.

`gas estimate` simulates a deployed contract call with `cast estimate` and returns transaction gas without sending a transaction. It resolves the same target/deployment context as `call` and `send`, accepts the same function selector shape as `send`, supports `--value`, and uses the active account address as `--from` when known. It does not require reading a private key.

`gas report` wraps `forge test --gas-report` for the active Foundry project and supports `--match-contract`. `gas snapshot` wraps `forge snapshot`, including `--diff` and `--check`, and returns stdout/stderr plus a success/failed status for JSON consumers.

### Diagnostics

```bash
consol gas compile <target>
consol gas estimate <target> <function> [args...] [--value <amount>]
consol gas report [--match-contract <name>]
consol gas snapshot [--diff|--check]
consol analyze
consol hints --file <path> [--contract <name>]
consol trace <tx_hash>
consol verify <target> [--address <address>] [--chain <chain>] [--verifier <name>]
```

`analyze` runs the project-level ConSol health check: `forge build` diagnostics plus `forge test`, normalized into findings for CI/editor consumption. Human mode exits non-zero when analysis fails; JSON mode returns status and findings.

`hints --file <path> [--contract <name>]` is the first editor protocol command. It resolves the file target, returns build diagnostics, compiler gas estimates, and best-effort source line numbers for function gas ghost text.

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

Watch mode emits one event per line:

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

## 6. Write Safety Rules

- `--chain-id` is an expected-chain guard. If RPC returns a different chain id, command must fail.
- `deploy` and `send` must preview transaction details before signing.
- Local/dev networks can allow `--yes`; remote networks require explicit confirmation unless policy allows automation.
- Mainnet should default to `typed-confirm` or `read-only`.
- Current implementation hardens this baseline by refusing `--yes` for non-`local` write policies. Human-mode `confirm` asks for `yes`; `typed-confirm` asks for the network name; JSON/NDJSON writes on non-local networks fail until a machine-safe confirmation policy is implemented.
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
