/** @jsxImportSource @opentui/solid */
import type { MessageKey } from "@consol/i18n";
import type { MouseEvent } from "@opentui/core";
import type { DevSettingsSnapshot } from "./runtime-types";
import { selectedBoxBackground, selectedReadableColor, theme } from "./theme";

export type LocalePreference = DevSettingsSnapshot["language"];
export const languagePreferences = ["system", "zh-CN", "en-US"] as const satisfies readonly LocalePreference[];
export const settingsSections = ["language", "stateDisplay", "contractActions"] as const;
export type SettingsSection = (typeof settingsSections)[number];

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function SettingsDetails(props: {
  readonly settings: DevSettingsSnapshot;
  readonly selectedIndex: number;
  readonly draftLanguage: LocalePreference;
  readonly draftShowRawStateValues: boolean;
  readonly draftHideNoArgReadActions: boolean;
  readonly message: string;
  readonly translate: Translate;
  readonly onSettingSelect: (section: SettingsSection) => void;
  readonly onDraftLanguageSelect: (language: LocalePreference) => void;
  readonly onDraftShowRawStateValuesSelect: (value: boolean) => void;
  readonly onDraftHideNoArgReadActionsSelect: (value: boolean) => void;
}) {
  return (
    <box width="100%" height="100%" flexDirection="column" paddingX={1} rowGap={0}>
      <SettingsMenuRow
        selected={props.selectedIndex === 0}
        title={props.translate("tui.settings.language.title")}
        value={languagePreferenceLabel(props.draftLanguage, props.translate)}
        onSelect={() => props.onSettingSelect("language")}
        onValuePrev={() => props.onDraftLanguageSelect(previousLanguagePreference(props.draftLanguage))}
        onValueNext={() => props.onDraftLanguageSelect(nextLanguagePreference(props.draftLanguage))}
      />
      <SettingsMenuRow
        selected={props.selectedIndex === 1}
        title={props.translate("tui.settings.stateDisplay.title")}
        value={stateRawDisplayLabel(props.draftShowRawStateValues, props.translate)}
        onSelect={() => props.onSettingSelect("stateDisplay")}
        onValuePrev={() => props.onDraftShowRawStateValuesSelect(!props.draftShowRawStateValues)}
        onValueNext={() => props.onDraftShowRawStateValuesSelect(!props.draftShowRawStateValues)}
      />
      <SettingsMenuRow
        selected={props.selectedIndex === 2}
        title={props.translate("tui.settings.contractActions.title")}
        value={contractActionFilterLabel(props.draftHideNoArgReadActions, props.translate)}
        onSelect={() => props.onSettingSelect("contractActions")}
        onValuePrev={() => props.onDraftHideNoArgReadActionsSelect(!props.draftHideNoArgReadActions)}
        onValueNext={() => props.onDraftHideNoArgReadActionsSelect(!props.draftHideNoArgReadActions)}
      />
      <box height={1} />
      <text fg={theme.color.muted} content={props.translate("tui.settings.singlePageHint")} />
      {props.settings.configPath === undefined ? null : (
        <text fg={theme.color.code} content={props.translate("tui.settings.configPath", { path: props.settings.configPath })} wrapMode="word" />
      )}
      {props.message.length === 0 ? null : <text fg={theme.color.read} content={props.message} wrapMode="word" />}
    </box>
  );
}

function SettingsMenuRow(props: {
  readonly selected: boolean;
  readonly title: string;
  readonly value: string;
  readonly onSelect: () => void;
  readonly onValuePrev: () => void;
  readonly onValueNext: () => void;
}) {
  return (
    <box
      height={1}
      flexDirection="row"
      {...selectedBoxBackground(props.selected)}
      onMouseDown={props.onSelect}
    >
      <text flexShrink={0} fg={props.selected ? theme.color.selected : theme.color.muted} content={props.selected ? "› " : "  "} />
      <text flexShrink={0} fg={props.selected ? theme.color.selected : theme.color.text} content={props.title} />
      <text flexShrink={0} fg={selectedReadableColor(props.selected, theme.color.border)} content="  " />
      <box
        height={1}
        flexDirection="row"
        onMouseDown={(event: MouseEvent) => {
          event.preventDefault?.();
          event.stopPropagation?.();
          props.onSelect();
          props.onValueNext();
        }}
      >
        <text flexShrink={0} fg={selectedReadableColor(props.selected, theme.color.border)} content="< " />
        <text flexShrink={0} fg={props.selected ? theme.color.selected : theme.color.muted} content={props.value} />
        <text flexShrink={0} fg={selectedReadableColor(props.selected, theme.color.border)} content=" >" />
      </box>
    </box>
  );
}

function previousLanguagePreference(language: LocalePreference): LocalePreference {
  const index = languagePreferences.indexOf(language);
  return languagePreferences[(index - 1 + languagePreferences.length) % languagePreferences.length] ?? "system";
}

function nextLanguagePreference(language: LocalePreference): LocalePreference {
  const index = languagePreferences.indexOf(language);
  return languagePreferences[(index + 1 + languagePreferences.length) % languagePreferences.length] ?? "system";
}

export function languagePreferenceLabel(language: LocalePreference, translate: Translate): string {
  switch (language) {
    case "system":
      return translate("tui.settings.language.option.system");
    case "zh-CN":
      return translate("tui.settings.language.option.zhCN");
    case "en-US":
      return translate("tui.settings.language.option.enUS");
  }
}

export function stateRawDisplayLabel(showRawStateValues: boolean, translate: Translate): string {
  return translate(showRawStateValues ? "tui.settings.stateDisplay.showRaw.on" : "tui.settings.stateDisplay.showRaw.off");
}

export function contractActionFilterLabel(hideNoArgReadActions: boolean, translate: Translate): string {
  return translate(hideNoArgReadActions ? "tui.settings.contractActions.noArgReads.hidden" : "tui.settings.contractActions.noArgReads.visible");
}
