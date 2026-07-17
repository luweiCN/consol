# `consol logs --watch` 流式 runner —— 设计文档

- 日期：2026-06-15
- 状态：已批准（待实现）
- 范围：`packages/cli`（命令实现 + 测试），复用 `@consol/rpc` / `@consol/core` 既有能力

## 背景与问题

`consol logs --watch` 目前在 `packages/cli/src/commands/logs.ts:72` 抛 `watchNotImplemented("logs")`。
需要把它做成长期运行的事件流。

核心矛盾：CLI 是请求-响应模型——`runCli` (`main.ts`) 先 `await routeCli` 拿到一次性的
`CliResult`，**之后**才把 `result.stdout` 写出去并 `process.exit`。流式命令无法用这个模型一次性返回，
因为输出要在运行期间持续产生、且要阻塞到用户 Ctrl-C。

结论（已定，非选择项）：watch 分支必须在运行期间**直接写 stdout**（绕过 `CliResult.stdout`），
返回的 promise 故意挂起到停止信号才 resolve。这与 `dev` 命令 `await runDevShell(...)` 是同款套路，
区别是 `logs --watch` 没有 TUI 接管 IO。

## 北极星

面向 **Solidity 新手、体验优先**。新手敲最短的命令就该得到最舒服的体验；自动化/管道是进阶需求，
用显式 flag 表达。

## 目标 / 非目标

目标：
- `consol logs <target> --watch` 实时显示该合约的新事件，直到 Ctrl-C 干净退出。
- 默认人类可读流；`--ndjson` 切到逐条 ndjson 流（脚本/管道）。
- 实现可自动化测试（解码 → 输出 → sequence → 停止清理全链路），不依赖 mock 全局 `process`。

非目标：
- 不回填历史事件（历史查询用不带 `--watch` 的一次性快照）。
- 不实现 `state --watch`（`interact.ts` 的平行占位，本任务不动）。
- 不引入通用流式框架；只解决 logs 这一处，注入点设计成可复用即可。

## 设计概览

```
runLogsCommand(watch 分支)
  → createReadContext            // address / rpc_url / artifact.abi（复用，要求已部署+有 code）
  → createEventIndex             // 跑 cast sig event 建 topic0→EventAbi（复用）
  → adapter.watchContractEvent({ address, abi, onLogs })   // 仅新事件，返回 unwatch
       onLogs(logs[]):
         每条 log → decodeLog(log, eventIndex) → DecodedLog（含 signature）
         → writeLine(format(decoded))     // format 按 globals.ndjson 选 human / ndjson
  → await waitForStop()          // 默认 = SIGINT promise
  → unwatch()
  → writeLine(收尾)              // 仅 human 模式
  → return { exitCode: 0, stdout: "", stderr: "" }
```

## 输出模式（心智模型）

| 命令 | 输出 | 面向 |
|---|---|---|
| `consol logs X --watch` | 人类可读实时流 | 新手 / 调试（默认） |
| `consol logs X --watch --ndjson` | ndjson 流 | 脚本 / 索引 / 管道 |
| `consol logs X --watch --json` | 报错 `ndjson_required` | 现有校验逻辑保留，引导用 `--ndjson` |

### human 流

启动横幅 + 逐条事件（复用 `logsHuman` 的单事件格式：label + location + args）+ Ctrl-C 收尾行。
横幅替新手补上"如何看历史"的引导，并解决"空屏是不是坏了"的困惑。

```
👀 Watching Counter at 0x5FbDB…0aa3 on local
   Events show up live below. Press Ctrl-C to stop · run without --watch to see past logs.

  PairSet(address owner)  ·  block 42  ·  tx 0xabc…
    owner: 0x1234…5678

^C
Stopped watching.
```

### ndjson 流

- 每条事件一行：`type: "logs.event"`，`sequence` 从 0 起递增，`data` = `DecodedLog`。
- （实现时调整）不再发独立的 `watch_started`：`CliNdjsonEventSchema.type` 是封闭枚举，再加一个 type 不值当；
  新手靠 human 流的 banner 已不困惑，脚本靠第一条 `logs.event` 即知订阅在工作。
- `"logs.event"` 已加入 `CliNdjsonEventSchema` 枚举（`packages/protocol/src/events.ts`）。
- **绝不掺任何非 JSON 行**（不打横幅/收尾），保护管道。
- 复用 `ndjsonEvent({ type, sequence, data, meta })`；`meta` = `{ version, command: "logs", network, account }`，
  与一次性快照及 `main.ts` 错误信封的 meta 对齐。

## 组件与注入点

新增到 `RunLogsCommandInput` 的可选字段（沿用 `dev` 的 `createRpcAdapter` / `launchTui` 注入风格）：

- `createRpcAdapter?: CreateDevRpcAdapter` —— 默认 `createDefaultRpcAdapter`（经 `dev-runtime.ts` 的
  `rpcAdapterForRuntime` 路径构造）。
- `writeLine?: (line: string) => void` —— 默认 `(line) => { process.stdout.write(line); }`。
  只负责把字符串写出去；human/ndjson 的格式化逻辑在命令内、按 `globals.ndjson` 分支。
- `waitForStop?: () => Promise<void>` —— 默认 `new Promise((resolve) => { process.once("SIGINT", resolve); })`。

router (`router.ts` 的 logs 分支) 不传这些，生产路径全走默认。测试调用 `runLogsCommand` 时注入。

## 决策记录

- **D1 数据来源**：复用 `createReadContext`（要求合约已部署且链上有 code）拿 address/rpc_url/abi；
  `--address` 已支持覆盖。与一次性快照一致。
- **D2 范围**：只订阅新事件，不回填历史。viem `watchContractEvent` 不传 `fromBlock` 即为此行为（零成本）。
- **D3 解码**：复用 `logs.ts` 的 `createEventIndex` + `decodeLog`，产出含 `signature` 的完整 `DecodedLog`，
  使流式输出与快照格式 100% 一致；不走 `dev-event-watch.ts` 的 `decodeEventLog`（那条路 `signature` 为 null）。
  代价：watch 启动时对每个 event 跑一次 `cast sig event`（一次性，快照模式也这么做）。
- **D4 输出默认**：watch 默认 human 流，`--ndjson` 才出 ndjson。**刻意偏离任务描述里"watch 配合 ndjson"
  的暗示**，理由见"北极星"。已与用户确认认可。
- **D5 可测试架构**：注入 `createRpcAdapter` / `writeLine` / `waitForStop`，使全链路可自动测试。
- **D6 viem log 规范化（实现中发现）**：viem `watchContractEvent` 回调的 log 字段是原生类型
  （`blockNumber` 为 bigint、`logIndex` 为 number），与 cast logs JSON（hex string）不同。直接喂 `decodeLog`
  会丢失 `block_number`/`log_index`，且 bigint 进 `raw` 后 `JSON.stringify` 崩溃。解法：`normalizeWatchLog`
  在解码前把顶层数值字段转成 hex string（cast 风格）；`decodeLog` 与一次性快照路径都不动。这是 D3
  「复用 decodeLog」的隐性代价，由真实 e2e 冒烟暴露（自动化测试初版用了 cast 风格 string 字段而漏掉）。
- **D7 `--ndjson` flag 位置（实现中发现）**：与一次性快照的 `--json` 处理一致，`--ndjson` 放命令后
  （留在 commandArgs）也识别：`input.globals.ndjson || input.commandArgs.includes("--ndjson")`。
- 退出码：用户主动 Ctrl-C 结束 watch 属正常结束，返回 `exitCode: 0`（与 `dev` 一致）。

## 错误处理

- `createReadContext` 抛 `ProjectError`（如 `deployment_stale` / `deployment_not_found`），在订阅建立**之前**发生，
  走 `main.ts` 现有错误信封：ndjson 模式 → `type:"error", sequence:0`；human 模式 → stderr 打 message。
- 单条 log 解码：`decodeLog` 对未知 topic0 / 畸形 log 已做 fallback（返回 `event:null` 而非抛错），
  单条异常不中断流。
- `watchContractEvent` 的 onLogs 一次可能收到多条 log，逐条展开成多行输出，sequence 全局递增。

## 测试策略（替换 `main.test.ts:6527` 的占位测试）

注入 fake adapter（`watchContractEvent` 同步触发一次 `onLogs([fakeLog])` 并返回可观测的 unwatch）+
fake `writeLine`（收集所有输出字符串）+ 受控 `waitForStop`（测试可立即/手动 resolve）。

用例：
1. **ndjson 流**：断言收集到 `[logs.event(seq0)]`，每行可 `JSON.parse` 且过 `CliNdjsonEventSchema`，
   `data` 形状为 `DecodedLog`，`unwatch` 被调用一次。
2. **human 流**：断言收集到横幅 + 事件文本（含合约名/地址/事件签名/args）+ 收尾行；无 JSON。
3. **多条 log 一次到达**：sequence 连续递增、每条一行。
4. **`--json` + `--watch`**：仍报 `ndjson_required`（现有逻辑回归）。
5. **未部署**：`createReadContext` 抛错走错误信封（保留占位测试的错误形状断言）。

`@consol/foundry` 的 `cast sig event` 在测试里由现有 `createFakeFoundry` fixture 覆盖（参考既有 logs 快照测试）。

## 实现清单（文件级改动）

- `packages/cli/src/commands/logs.ts`
  - `RunLogsCommandInput` 加 `createRpcAdapter?` / `writeLine?` / `waitForStop?`。
  - 移除 `watch` 分支的 `throw watchNotImplemented(...)`，改为调用新的 watch runner。
  - 新增 watch runner：建 context → eventIndex → 订阅 → 格式化写出 → 等停止 → 清理。
  - 新增 human 单事件 formatter（复用/抽取 `logsHuman` 的单事件部分）与 ndjson formatter。
  - 视情况删除已不再使用的 `watchNotImplemented`（若 logs 不再引用）。
- `packages/cli/src/router.ts`：logs 分支保持不传注入参数（无需改，确认即可）。
- `packages/cli/src/main.test.ts`：替换 `logs --watch` 占位测试为上述注入式用例。

## 复用清单（不新造轮子）

- `createReadContext`（`interact-context.ts`）、`createEventIndex` / `decodeLog` / `logsHuman`（`logs.ts`）
- `ndjsonEvent`（`commands/ndjson.ts`）
- `rpcAdapterForRuntime` / `networkRuntimeForSelection` / `CreateDevRpcAdapter`（`dev-runtime.ts`）
- `RpcAdapter.watchContractEvent`（`@consol/rpc`）
