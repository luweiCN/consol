# CLI

This folder will contain the Rust binary that ships the `consol` command.

Current priority:

1. Build a small but real CLI.
2. Wrap Foundry commands with structured output.
3. Implement stateful deploy/call/send/state workflows.
4. Add `consol dev` TUI after the command foundation is stable.

Initial commands to implement:

```bash
consol detect
consol build
consol snapshot
consol inspect <target>
consol chain start
consol network status
consol account list
consol deploy <target>
consol call <target> <function> [args...]
consol send <target> <function> [args...]
consol state <target>
```

`<target>` can be either a Foundry artifact contract name like `Counter` or a single-file selector like `./Counter.sol:Counter`.

See:

- [PRD](/Users/luwei/code/ai/consol/docs/product/PRD.md)
- [CLI Spec](/Users/luwei/code/ai/consol/docs/product/CLI_SPEC.md)
- [Roadmap](/Users/luwei/code/ai/consol/docs/product/ROADMAP.md)
