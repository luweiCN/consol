import { readFileSync, statSync } from "node:fs";

const requiredFiles = [
  "packages/protocol/src/events.ts",
  "packages/protocol/snapshots/tx-preview.ndjson",
] as const;

const failures: string[] = [];

for (const file of requiredFiles) {
  try {
    statSync(file);
  } catch {
    failures.push(`missing ${file}`);
  }
}

if (failures.length === 0) {
  const lines = readFileSync("packages/protocol/snapshots/tx-preview.ndjson", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  lines.forEach((line, index) => {
    try {
      JSON.parse(line);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(`invalid NDJSON at tx-preview.ndjson:${index + 1}: ${detail}`);
    }
  });
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("check-protocol: ok");
