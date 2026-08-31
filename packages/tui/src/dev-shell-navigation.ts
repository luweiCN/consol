import type { DevPanel } from "@consol/core";
import type { MessageKey } from "@consol/i18n";
import { nerdIcon } from "./icons";

export const basePanels = ["contract", "state", "feed"] as const satisfies readonly DevPanel[];
export type DevWorkspacePanel = (typeof basePanels)[number];

export const topTabs = ["dev", "transactions", "events", "diagnostics", "settings"] as const;
export type DevTopTab = (typeof topTabs)[number];

export const panelKeys = {
  files: "tui.panel.files",
  contract: "tui.panel.contract",
  state: "tui.panel.state",
  feed: "tui.panel.feed",
  diagnostics: "tui.panel.diagnostics",
} as const satisfies Record<DevPanel, MessageKey>;

export const topTabKeys = {
  dev: "tui.tab.dev",
  transactions: "tui.tab.transactions",
  diagnostics: "tui.tab.diagnostics",
  events: "tui.tab.events",
  settings: "tui.tab.settings",
} as const satisfies Record<DevTopTab, MessageKey>;

export const topTabIcons = {
  dev: nerdIcon.dev,
  transactions: nerdIcon.transactions,
  diagnostics: nerdIcon.diagnostics,
  events: nerdIcon.events,
  settings: nerdIcon.settings,
} as const satisfies Record<DevTopTab, string>;

export const panelIcons = {
  files: nerdIcon.file,
  contract: nerdIcon.contract,
  state: nerdIcon.state,
  feed: nerdIcon.activity,
  diagnostics: nerdIcon.diagnostics,
} as const satisfies Record<DevPanel, string>;
