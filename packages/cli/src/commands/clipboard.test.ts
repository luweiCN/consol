import { describe, expect, test } from "bun:test";
import { systemClipboardCommand } from "./dev";

describe("system clipboard fallback", () => {
  test("uses the common clipboard command for each desktop platform", () => {
    expect(systemClipboardCommand("darwin", {})).toEqual(["pbcopy"]);
    expect(systemClipboardCommand("linux", { WAYLAND_DISPLAY: "wayland-0" })).toEqual(["wl-copy"]);
    expect(systemClipboardCommand("linux", { DISPLAY: ":0" })).toEqual(["xclip", "-selection", "clipboard"]);
    expect(systemClipboardCommand("win32", {})).toEqual(["clip.exe"]);
    expect(systemClipboardCommand("freebsd", {})).toBeNull();
  });
});
