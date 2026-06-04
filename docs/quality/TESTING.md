# Testing

ConSol 的 TS/OpenTUI 测试按产品风险分层。新增行为时优先写能描述用户可见结果的测试。

## Protocol

`packages/protocol` 使用 Zod schema 和 golden snapshot 保护 JSON/NDJSON 合同。

命令：

```bash
bun test packages/protocol
bun run check:protocol
```

## Core

`packages/core` 测业务状态和状态转换，不依赖 TUI、Foundry 或进程。

命令：

```bash
bun test packages/core
```

## Foundry And Testkit

`packages/testkit` 提供 fake `forge` / `cast` / `anvil`。`packages/foundry` 的测试必须通过 fake tools 验证命令参数，不能依赖真实链。

命令：

```bash
bun test packages/foundry packages/testkit
```

## OpenTUI

`packages/tui` 使用 OpenTUI test renderer 验证字符帧、style spans、键盘、鼠标、滚轮和 resize。英文和中文都要覆盖。

命令：

```bash
bun run test:tui
bun run check:no-inline-ui-copy
bun run check:boundaries
```

## CLI Smoke

`packages/cli` 保护可安装入口和基础命令。`doctor --json`、`--help`、`CONSOL_LANG=zh-CN` 是最小 smoke。

命令：

```bash
bun test packages/cli
bun test packages/cli/src/bin-smoke.test.ts
```

## Release Gates

The active release path is TS-only. Release gates should only invoke the TS/Bun toolchain.

发布前至少运行：

```bash
bun install --frozen-lockfile
bun run release:check
```

后续打包阶段再补 Homebrew、Windows 和 Linux package-manager smoke。
