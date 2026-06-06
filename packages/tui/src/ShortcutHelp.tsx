/** @jsxImportSource @opentui/solid */
import type { MessageKey } from "@consol/i18n";
import type { ModalRect } from "./modal-layout";
import { theme } from "./theme";

type ShortcutTab = "dev" | "transactions" | "events" | "diagnostics" | "settings";
type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function ShortcutBar(props: {
  readonly translate: Translate;
  readonly activeTab: ShortcutTab;
}) {
  const key = () =>
    props.activeTab === "transactions"
      ? "tui.shortcuts.bar.transactions"
      : props.activeTab === "events"
        ? "tui.shortcuts.bar.events"
        : props.activeTab === "diagnostics"
          ? "tui.shortcuts.bar.diagnostics"
          : props.activeTab === "settings"
            ? "tui.shortcuts.bar.settings"
            : "tui.shortcuts.bar.dev";
  return (
    <box
      id="shortcut-bar"
      border
      borderStyle="rounded"
      borderColor={theme.color.border}
      height={3}
      title={props.translate("tui.shortcuts.title")}
    >
      <text fg={theme.color.muted} content={props.translate(key())} />
    </box>
  );
}

export function ShortcutOverlay(props: {
  readonly translate: Translate;
  readonly rect: ModalRect;
}) {
  const keys = [
    "tui.shortcuts.filePicker",
    "tui.shortcuts.build",
    "tui.shortcuts.deploy",
    "tui.shortcuts.readFilter",
    "tui.shortcuts.refresh",
    "tui.shortcuts.tabs",
    "tui.shortcuts.network",
    "tui.shortcuts.account",
    "tui.shortcuts.open",
    "tui.shortcuts.quit",
    "tui.shortcuts.close",
  ] as const satisfies readonly MessageKey[];

  return (
    <box
      id="shortcut-overlay"
      position="absolute"
      zIndex={30}
      top={props.rect.top}
      left={props.rect.left}
      width={props.rect.width}
      height={props.rect.height}
      border
      borderStyle="rounded"
      borderColor={theme.color.borderFocus}
      backgroundColor={theme.background.overlay}
      title={props.translate("tui.shortcuts.title")}
      bottomTitle={props.translate("tui.shortcuts.closeHint")}
      bottomTitleAlignment="right"
      flexDirection="column"
      paddingX={1}
    >
      {keys.map((key) => (
        <text fg={theme.color.text} content={props.translate(key)} />
      ))}
    </box>
  );
}
