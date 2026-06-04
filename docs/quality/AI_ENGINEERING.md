# AI Engineering

ConSol 的 TS/OpenTUI 重写使用三层质量体系：技能指导写法，脚本和测试阻止违规，fresh-context reviewer 检查 diff。三层都要跑，不能互相替代。

## Writer Flow

1. 先读当前产品合同和相关包边界。
2. 先写行为测试、schema snapshot 或 TUI fixture。
3. 再实现最小代码，让测试通过。
4. 每组行为单独提交，提交前运行相关 package gate。
5. 完成阶段前运行 `bun run verify`。

## Automated Gates

- `bun run typecheck`：所有 TS package composite build。
- `bun run lint`：Oxlint，禁止 warning。
- `bun run check:size`：防止文件失控增长。
- `bun run check:boundaries`：防止 TUI 越层调用 Foundry/process。
- `bun run check:i18n`：检查 `en-US` / `zh-CN` key 和 placeholder 一致。
- `bun run check:no-inline-ui-copy`：阻止 TUI 组件硬编码用户可见文案。
- `bun run check:protocol`：协议 snapshot 必须稳定。

## Reviewer Flow

Reviewer 使用 fresh context，先读 diff，再输出 findings first。阻塞问题必须包含文件和行号；没有阻塞问题时，说明剩余风险和已跑验证。

Blocking 条件：

- 行为合同或 JSON/NDJSON schema 变化但没有测试。
- 包边界被破坏。
- 写交易路径跳过 preview / confirmation。
- 新 TUI 文案没有 i18n key。
- 未运行或无法解释 `bun run verify`。
