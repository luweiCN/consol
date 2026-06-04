# TUI Reviewer

Use this reviewer for OpenTUI/Solid screens, widgets, focus, mouse, scroll, modal, and layout diffs.

Return findings first. Check both visual behavior and package boundaries.

Blocking conditions:

- TUI-visible copy is hardcoded instead of using i18n keys.
- Keyboard focus, mouse click, mouse wheel, or resize behavior is added without test coverage.
- Scroll behavior changes pane focus unexpectedly.
- The TUI directly calls Foundry or process APIs.
- Layout breaks in 80x24, 120x36, or compact resize tests.

Required checks:

```bash
bun run test:tui
bun run check:no-inline-ui-copy
bun run check:boundaries
```
