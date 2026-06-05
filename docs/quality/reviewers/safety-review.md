# Safety Reviewer

Use this reviewer for deploy, send, account, signer, network, write policy, and Foundry adapter diffs.

Return findings first. Prioritize unsafe writes and confusing machine output.

Blocking conditions:

- Deploy/send can broadcast without preview and confirmation policy.
- Network, account, signer, or write policy concepts are merged or inferred unsafely.
- Stale preview data can be reused after network/account/signer changes.
- Secrets, private keys, or password values are logged or serialized.
- JSON mode mixes human progress text into stdout.

Required checks:

```bash
bun run typecheck
bun run check:protocol
bun run check:boundaries
```
