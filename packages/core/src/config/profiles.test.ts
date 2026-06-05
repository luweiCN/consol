import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveActiveNetwork } from "./profiles";

describe("config profile persistence", () => {
  test("rewrites existing config files with private permissions", () => {
    const root = mkdtempSync(join(tmpdir(), "consol-config-perms-"));
    const configDir = join(root, ".config", "consol");
    const configPath = join(configDir, "config.toml");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, 'active_network = "local"\n');
    chmodSync(configDir, 0o755);
    chmodSync(configPath, 0o644);

    saveActiveNetwork({ env: { CONSOL_CONFIG: configPath }, name: "dev2" });

    expect(statMode(configDir)).toBe("700");
    expect(statMode(configPath)).toBe("600");
  });
});

function statMode(path: string): string {
  return (statSync(path).mode & 0o777).toString(8);
}
