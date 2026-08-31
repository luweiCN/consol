import { describe, expect, test } from "bun:test";
import { parseConsolConfig, removeSectionKey, setSectionString, setTopLevelString } from "./profile-toml";

describe("profile TOML helpers", () => {
  test("parses escaped quoted strings without preserving TOML escapes", () => {
    const config = parseConsolConfig('active_network = "hello\\"world\\\\path"\n');

    expect(config.active_network).toBe('hello"world\\path');
  });

  test("updates top-level string keys written without spaces around equals", () => {
    const next = setTopLevelString('active_network="old"\n[ui]\nlanguage = "en-US"\n', "active_network", "new");

    expect(next).toBe('active_network = "new"\n[ui]\nlanguage = "en-US"\n');
  });

  test("updates section string keys written without spaces around equals", () => {
    const next = setSectionString('[ui]\nlanguage="en-US"\nshow_raw_state_values = true\n', "[ui]", "language", "zh-CN");

    expect(next).toBe('[ui]\nlanguage = "zh-CN"\nshow_raw_state_values = true\n');
  });

  test("ignores the removed no-argument read filter preference", () => {
    const config = parseConsolConfig('[ui]\nlanguage = "zh-CN"\nshow_raw_state_values = false\nhide_no_arg_read_actions = true\n');

    expect(config.ui).toEqual({
      language: "zh-CN",
      show_raw_state_values: false,
    });
  });

  test("removes a retired key only from its requested section", () => {
    const source = '[ui]\nhide_no_arg_read_actions = true\n[other]\nhide_no_arg_read_actions = true\n';

    expect(removeSectionKey(source, "[ui]", "hide_no_arg_read_actions")).toBe(
      '[ui]\n[other]\nhide_no_arg_read_actions = true\n',
    );
  });
});
