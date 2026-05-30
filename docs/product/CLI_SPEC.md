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
- `logs` 使用 ABI 解码事件。
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

`demo` is the single-file teaching shortcut: resolve file, create scratch project, build, start local chain if needed, deploy, then print next commands or enter console. The first implementation supports constructor args and returns a JSON summary with deployment address and suggested follow-up commands.

### Gas

```bash
consol gas compile <target>
consol gas estimate <target> <function> [args...]
consol gas report
consol gas snapshot
```

`gas compile` reads Foundry compiler estimates via `forge inspect gasEstimates` and returns creation plus external function estimates. This is the first structured data source for future editor ghost-text gas hints.

### Diagnostics

```bash
consol gas compile <target>
consol gas estimate <target> <function> [args...]
consol gas report [--match-contract <name>]
consol gas snapshot [--diff|--check]
consol analyze
consol trace <tx_hash>
consol verify <target>
```

这些命令在 MVP 后进入增强阶段。

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
