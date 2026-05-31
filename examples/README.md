# examples

This directory contains small fixtures for manual testing and documentation examples.

## `counter-foundry`

A minimal Foundry Counter project.

Useful commands:

```bash
consol detect --project examples/counter-foundry
consol build --project examples/counter-foundry
consol inspect Counter --project examples/counter-foundry
consol dev --project examples/counter-foundry
```

After starting Anvil, it can also validate the local interaction loop:

```bash
consol chain start --project examples/counter-foundry
consol deploy Counter --project examples/counter-foundry
consol call Counter number --project examples/counter-foundry
consol send Counter setNumber 42 --yes --project examples/counter-foundry
consol state Counter --project examples/counter-foundry
consol activity Counter --project examples/counter-foundry
```

## `counter-single-file`

A standalone `Counter.sol` used to validate single-file mode.

Useful commands:

```bash
consol detect examples/counter-single-file/Counter.sol:Counter
consol build examples/counter-single-file/Counter.sol:Counter
consol inspect examples/counter-single-file/Counter.sol:Counter
consol dev examples/counter-single-file/Counter.sol:Counter
consol demo examples/counter-single-file/Counter.sol:Counter
```

Single-file mode creates a scratch Foundry project under `~/.cache/consol/scratch/` and does not write `.consol/` beside the source file by default.
