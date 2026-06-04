import { describe, expect, test } from "bun:test";
import { resolveConfigPaths } from "./paths";

describe("config paths", () => {
  test("defaults to HOME/.config/consol", () => {
    expect(resolveConfigPaths({ env: { HOME: "/home/alice" } })).toEqual({
      configDir: "/home/alice/.config/consol",
      configPath: "/home/alice/.config/consol/config.toml",
      logDir: "/home/alice/.config/consol/logs",
      devLogPath: "/home/alice/.config/consol/logs/consol-dev.log",
    });
  });

  test("CONSOL_CONFIG_DIR wins over CONSOL_CONFIG parent", () => {
    expect(
      resolveConfigPaths({
        env: {
          HOME: "/home/alice",
          CONSOL_CONFIG_DIR: "/tmp/consol",
          CONSOL_CONFIG: "/tmp/other/config.toml",
        },
      }).configDir,
    ).toBe("/tmp/consol");
  });

  test("CONSOL_CONFIG parent defines config dir when config dir is absent", () => {
    expect(resolveConfigPaths({ env: { CONSOL_CONFIG: "/tmp/custom/consol.toml" } }).configDir).toBe("/tmp/custom");
  });

  test("CONSOL_LOG_DIR overrides only the log directory", () => {
    expect(resolveConfigPaths({ env: { HOME: "/home/alice", CONSOL_LOG_DIR: "/tmp/logs" } })).toEqual({
      configDir: "/home/alice/.config/consol",
      configPath: "/home/alice/.config/consol/config.toml",
      logDir: "/tmp/logs",
      devLogPath: "/tmp/logs/consol-dev.log",
    });
  });
});
