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
consol activity <target>
consol dev [target]
```

`<target>` can be either a Foundry artifact contract name like `Counter` or a single-file selector like `./Counter.sol:Counter`.

`consol dev` can also be launched without a target. It scans Solidity files in the current Foundry project or single-file demo directory, opens a fuzzy contract picker when a contract must be chosen, and keeps the main flow in the Contract workspace: build ABI, deploy, run read/write functions, and inspect state/results without guessing which command list item is executable. The Contract workspace is terminal-cockpit style: compact context strip, focused runnable ABI list, selected-row details, State Watch, Activity, and bottom keybar. Pressing a read/write function before deployment now opens the deploy preview first. Durable Activity data is the same snapshot returned by `consol activity <target>`.

See:

- [PRD](/Users/luwei/code/ai/consol/docs/product/PRD.md)
- [CLI Spec](/Users/luwei/code/ai/consol/docs/product/CLI_SPEC.md)
- [Roadmap](/Users/luwei/code/ai/consol/docs/product/ROADMAP.md)
