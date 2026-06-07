import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { smokeBinary } from "./smoke";

describe("package smoke", () => {
  test("runs the compiled dev json path against a generated project", async () => {
    const root = mkdtempSync(join(tmpdir(), "consol-package-smoke-"));
    const binaryPath = join(root, "consol");
    const callsPath = join(root, "calls.ndjson");
    writeFileSync(callsPath, "");
    writeFileSync(binaryPath, fakeBinaryScript(callsPath));
    chmodSync(binaryPath, 0o755);

    const result = await smokeBinary({ binaryPath, cwd: root, env: { PATH: Bun.env.PATH } });

    expect(result.version.stdout.trim()).toBe("consol 0.12.3");
    expect(result.doctor.ok).toBe(true);
    expect(result.dev.ok).toBe(true);
    expect(readCalls(callsPath)).toContainEqual(["--json", "--project", result.dev.projectRoot, "dev", "Counter"]);
  });
});

function fakeBinaryScript(callsPath: string): string {
  return `#!${process.execPath}
import { appendFileSync } from "node:fs";

const args = Bun.argv.slice(2);
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + "\\n");

if (args.length === 1 && args[0] === "--version") {
  console.log("consol 0.12.3");
  process.exit(0);
}

if (args.join(" ") === "doctor --json") {
  console.log(JSON.stringify({ ok: true, data: { status: "ok" }, error: null, meta: { command: "doctor" } }));
  process.exit(0);
}

if (args[0] === "--json" && args[1] === "--project" && args[3] === "dev" && args[4] === "Counter") {
  console.log(JSON.stringify({ ok: true, data: { contract: "Counter", project_root: args[2] }, error: null, meta: { command: "dev" } }));
  process.exit(0);
}

console.error("unexpected args: " + args.join(" "));
process.exit(1);
`;
}

function readCalls(path: string): readonly string[][] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as string[]);
}
