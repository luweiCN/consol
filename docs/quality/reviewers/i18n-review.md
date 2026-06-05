# I18N Reviewer

Use this reviewer for locale, catalog, copy, CLI help, TUI copy, and placeholder diffs.

Return findings first. Treat missing translations as product bugs, not cleanup tasks.

Blocking conditions:

- `en-US` and `zh-CN` keys diverge.
- Placeholder names diverge across locales.
- TUI user-visible text appears inline in TSX.
- `CONSOL_LANG=zh-CN` behavior regresses.
- CJK text is added to TUI without a character-frame or resize check.

Required checks:

```bash
bun run check:i18n
bun run check:no-inline-ui-copy
bun run test:i18n
bun run test:tui
```
