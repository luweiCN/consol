# Dev TUI Complex State Panel

This document defines the product behavior for showing full Solidity arrays,
structs, and mappings in the `consol dev` State panel.

## Goal

Make the State panel useful for real contracts whose important state is not
available through no-argument ABI getters.

The current State panel reads zero-argument view/pure functions. That works for
simple public scalar variables, but it does not cover:

- public dynamic arrays, whose ABI getter requires an index;
- structs whose important fields need a richer presentation;
- mappings, which require user-provided keys;
- nested values that need detail browsing instead of one flat text line.

The target experience is a terminal-native state browser:

1. Show a compact state summary by default.
2. Let users select a state row with the keyboard.
3. Open a detail view with `Enter`.
4. Let users copy values from the detail view.
5. Keep the main State panel fast by reading only a bounded summary.

## Core Model

The feature combines three data sources:

- ABI getter reads for ordinary zero-argument values.
- Solidity storage layout from `forge inspect <target> storage-layout --json`.
- Chain storage reads through RPC, using `eth_getStorageAt` via the RPC adapter.

ABI alone is not enough. The storage layout is required to know which state
variables are arrays, structs, mappings, packed values, and nested storage
types.

Storage reads are RPC reads. They do not sign transactions, do not broadcast
transactions, and do not consume gas.

## State Rows

The State panel should contain selectable rows.

Supported row kinds:

- ABI reader row: a zero-argument read result.
- Storage scalar row: a decoded storage value.
- Array row: length plus a small preview.
- Struct row: a compact field preview.
- Mapping row: a compact preview from compatible Key Book entries.
- Error row: a failed read with a short explanation.

Rows should remain readable in compact mode. Large data belongs in the detail
view, not in the list row.

## Arrays

For dynamic arrays:

- The summary row reads the array length and the first few items.
- The default preview size is 3 items.
- The row must make truncation explicit.

Example:

```text
numbers uint256[] len=128 [1, 2, 3, ...]
```

For fixed arrays:

- The summary row reads the first few items.
- If the array length is small, the full array may fit in the row.
- The detail view shows the full array with index rows.

Array details:

```text
numbers uint256[] len=128

[0] 1
[1] 2
[2] 3
[3] 4
```

Remote RPC detail views may load large arrays in pages. The first implementation
may use a fixed detail cap and show a clear count when not every item is loaded.

## Structs

Struct summary rows show the first few decoded fields:

```text
user User {id: 1, owner: 0xf39f...2266, active: true, ...}
```

The detail view shows all fields in storage order:

```text
user User

id      1
owner   0xf39f...2266
active  true
```

Nested structs and arrays should render as nested detail sections when the
decoder supports them. Summary rows should stay shallow and bounded.

## Mapping Key Book

Mappings cannot be enumerated from chain storage. Solidity stores mapping
values at hash-derived slots and does not store a list of keys.

ConSol should not try to decide which key "belongs" to which mapping. The user
maintains a Key Book of typed keys, and each mapping consumes compatible keys by
type.

The Key Book is stored separately from deployment records:

```text
.consol/state-keys.json
```

It is not part of `.consol/deployments.json`. Forgetting a deployment entry must
not delete state debugging preferences.

Key Book entries have:

- type: `address`, `uint256`, `bytes32`, `bool`, or another supported ABI type;
- value: the canonical key value;
- label: an optional short human label, such as `anvil0`, `owner`, or `router`;
- enabled flag: disabled keys stay saved but are not used by default scans.

Example:

```json
{
  "version": 1,
  "contracts": {
    "layout:abc123": {
      "target": "src/Token.sol:Token",
      "contract": "Token",
      "keys": [
        {
          "type": "address",
          "value": "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
          "label": "anvil0",
          "enabled": true
        },
        {
          "type": "uint256",
          "value": "1",
          "label": "token 1",
          "enabled": true
        }
      ],
      "tuple_keys": [
        {
          "types": ["address", "address"],
          "values": [
            "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
          ],
          "label": "anvil0 -> anvil1",
          "enabled": true
        }
      ]
    }
  }
}
```

The contract scope is keyed by a stable storage layout id, not by deployment
address. This lets users deploy the same contract many times and reuse the same
keys while values are still read from the currently selected deployed address.

## Mapping Summary Reads

Mapping rows should not scan the full Key Book in the main State panel.

Summary behavior:

- A single-level mapping reads at most 3 compatible enabled keys.
- A nested mapping reads at most 3 compatible enabled tuple keys.
- Default values are hidden in the summary.
- The row must show how many keys were checked.
- The row must not claim the mapping is empty when only a summary subset was
  read.

Example:

```text
balances mapping(address => uint256) anvil0=100, alice=25 (3 checked)
admins mapping(address => bool) 3 checked, all default
```

The panel should include a hint when mapping defaults are hidden:

```text
mapping default values hidden; Enter shows checked keys
```

## Mapping Detail Reads

Opening a mapping detail view reads all compatible enabled Key Book entries for
that mapping.

For a single-level mapping:

```text
balances(address => uint256)

anvil0  0xf39f...2266  100
alice   0xabc...7890   0
router  0xdef...0123   0

1 non-default / 3 keys checked
```

The detail view may default to hiding default values if the list is large, but
it must provide a way to show checked default values because `0`, `false`, and
empty values can be meaningful while debugging.

For nested mappings:

```solidity
mapping(address => mapping(address => uint256)) allowances;
```

ConSol should use tuple keys:

```text
allowances(address, address => uint256)

anvil0 -> anvil1  1000
alice -> router   0
```

ConSol must not create the Cartesian product of all address keys. If the Key
Book has 100 address keys, a nested `mapping(address => mapping(address => T))`
must not automatically perform 10,000 reads.

## Key Book Interaction

The Key Book should be manageable from the State panel and mapping detail views.

Minimum interactions:

- Add key for the current layout.
- Edit key label.
- Enable or disable key.
- Delete key.
- Add tuple key for nested mappings.

The default add flow from a mapping detail should preselect the required type:

```text
Add key for mappings with key type address

key:   0xf39f...
label: anvil0
```

For a nested mapping:

```text
Add tuple key for allowances(address,address)

owner:   0xf39f...
spender: 0x7099...
label:   anvil0 -> anvil1
```

Labels are optional, but the UI should encourage them. Without labels, address
keys are hard to distinguish.

## Selection And Details

The State panel becomes selectable when it has rows.

Keyboard behavior:

- `Up` / `Down`: select state row.
- `Enter`: open detail for selected row.
- `c`: copy selected value or row summary when available.
- `r`: refresh state snapshot.
- Detail modal uses the existing modal close/cancel pattern.

The detail view should use the same interaction style as transaction details:
selectable text, copy support, and clear metadata.

## Refresh Strategy

The main panel must stay responsive.

Refresh triggers:

- TUI launch.
- Selected deployed contract changes.
- New deployment or send completes.
- Manual refresh.
- Low-frequency live refresh tick.

Summary limits:

- Array preview: 3 items.
- Struct preview: first few fields that fit.
- Mapping summary: 3 compatible keys or tuple keys.
- Remote network reads should use lower caps than local Anvil if latency or
  rate limits are visible.

Implementation requirements:

- Run storage reads in the CLI/runtime layer, not inside TUI components.
- Use bounded concurrency for RPC storage reads.
- Cancel or ignore stale refreshes when the user switches deployed contract or
  network.
- Keep the previous snapshot visible while a refresh is in flight.

## Defaults

Default values are:

- numeric zero;
- `false`;
- zero address;
- empty fixed bytes;
- empty dynamic bytes/string;
- structs whose displayed fields are all default;
- arrays with length zero.

Summary rows hide mapping entries whose decoded value is default. Detail views
can show them.

Default hiding must be described as a display rule, not as an existence claim.
A mapping key with a default value may still be semantically important.

## Package Boundaries

Expected ownership:

- `packages/core`: storage layout normalization, storage slot planning, value
  decoding, Key Book data model, and private JSON persistence helpers.
- `packages/rpc`: `eth_getStorageAt` wrapper and retry behavior.
- `packages/cli`: command/runtime wiring, storage layout acquisition, snapshot
  assembly, concurrency limits, and TUI handlers.
- `packages/tui`: row selection, summaries, details, Key Book modals, and copy
  interactions.
- `packages/i18n`: all user-visible copy.

The TUI must consume structured snapshots and actions. It must not construct
Foundry commands or RPC requests directly.

## Non-Goals

This feature does not include:

- automatic mapping key discovery from events, transactions, or source code;
- automatic assignment of a key to a specific mapping;
- mapping key enumeration from chain storage;
- debugger-grade storage tracing;
- Explorer API integration;
- per-deployed-address Key Book overrides in the first implementation.

A future per-address override can cover keys that should only appear for one
deployed instance. The default scope is storage layout, because that matches
repeated local deployment workflows.

## Acceptance Criteria

- `uint256[] public numbers = [1, 2, 3, 4]` appears in State as an array row
  with length and preview items.
- Selecting the array row and pressing `Enter` opens details with indexed
  values.
- Public structs appear as struct rows with field previews and full detail.
- Mappings appear as mapping rows when compatible Key Book entries exist.
- Mapping summary reads only the first few compatible keys and hides default
  values.
- Mapping detail reads all compatible enabled keys for that mapping.
- Key Book entries persist under `.consol/state-keys.json` and survive
  deployment cache deletion.
- Re-deploying the same storage layout reuses the Key Book.
- Remote RPC reads do not block the TUI and do not consume gas.
- TUI-visible strings are localized in English and Chinese.
