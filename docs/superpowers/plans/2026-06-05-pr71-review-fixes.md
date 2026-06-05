# PR #71 Review Fix Plan

Date: 2026-06-05
Scope: verified PR comments plus follow-up instruction that P3/P4/P5 issues also need fixes.

## Severity Buckets

### P0

- Release gate did not enforce a frozen lockfile.
- JSON failure paths returned success exit codes.
- CLI runtime network resolution ignored `--network`, `--rpc-url`, `ETH_RPC_URL`, and `--chain-id` in key commands.
- Remote write automation had no `--confirm-network <name>` path and could not prove named-network confirmation.
- NDJSON error paths fell back to human stderr.
- CLI NDJSON wrapper events were not schema-validated by the protocol gate.

### P1

- Single-file scratch projects were unstable and missed import forms.
- Private keys were passed in argv for write commands.
- `gas compile` did not force a fresh build.
- TOML editing corrupted or missed some keys/quoted values.
- Local `.consol/*.json` and config state could keep broad existing permissions.
- Human output for deploy/list/all/state/logs omitted essential rows.
- `state --watch` / `logs --watch` falsely behaved like one-shot commands.
- Foundry subprocesses had no timeout.

### P2

- RPC adapter had no retry layer and fallback event polling did not catch `getLogs` failures.
- Invalid local JSON state files surfaced as internal errors.
- `deploy --all` top-level metadata could disagree with the actual deployment network.

### P3/P4/P5

- Linux/Windows system clipboard fallback was missing.
- Dev preview feed was unbounded.
- Decimal formatting broke for zero-decimal units.
- Anvil account name parsing was unnecessarily narrow.
- `console` and `snapshot` reported default local network instead of active/global network.

## Fix Strategy

- Prefer behavior-level regression tests before implementation.
- Keep protocol/schema changes explicit and covered by `check:protocol`.
- Do not implement fake streaming for `--watch`; fail clearly with `watch_not_implemented` until a streaming runner exists.
- Preserve package boundaries: network config in core, process/RPC calls in CLI/foundry/rpc adapters, TUI state capping in core reducer.

## Status

- Fixed: lockfile gate, JSON exit codes, chain-id parsing, TOML edits, private file writes, protocol NDJSON schema, single-file scratch stability, gas compile build, private key argv exposure, runtime network resolver, remote write confirmation, NDJSON error events, watch clear failure, human output, deploy-all metadata, Foundry timeout, RPC retry/catch, invalid JSON errors, config permission rewrites, clipboard command selection, feed cap, decimal zero handling, console/snapshot network metadata.
- Remaining risk: `state --watch` and `logs --watch` are intentionally blocked instead of streaming; implementing true streaming needs a CLI streaming result model rather than a one-shot `CliResult`.
