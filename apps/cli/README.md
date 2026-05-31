# CLI

This folder contains the Rust binary that ships the `consol` command.

Current priority:

1. Build a small but real CLI.
2. Wrap Foundry commands with structured output.
3. Implement stateful deploy/call/send/state workflows.
4. Keep improving `consol dev` as the source-first TUI cockpit.

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
consol demo <target> [constructor_args...]
consol call <target> <function> [args...]
consol send <target> <function> [args...]
consol state <target>
consol dev [target]
```

`<target>` can be either a Foundry artifact contract name like `Counter` or a single-file selector like `./Counter.sol:Counter`.

`consol dev` can also be launched without a target. It scans Solidity files in the current Foundry project or single-file demo directory, opens the Source Explorer, and lets the user search/select contracts before deploy/call/send actions.

See:

- [PRD](/Users/luwei/code/ai/consol/docs/product/PRD.md)
- [CLI Spec](/Users/luwei/code/ai/consol/docs/product/CLI_SPEC.md)
- [Roadmap](/Users/luwei/code/ai/consol/docs/product/ROADMAP.md)
