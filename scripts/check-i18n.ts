import { statSync } from "node:fs";

type Catalog = Record<string, string>;

function requirePath(path: string): void {
  try {
    statSync(path);
  } catch {
    console.error(`check-i18n: missing ${path}`);
    process.exit(1);
  }
}

function placeholders(message: string): string[] {
  return Array.from(message.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g), (match) => match[1] ?? "").sort();
}

function diffKeys(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((key) => !rightSet.has(key));
}

requirePath("packages/i18n/src/catalog.ts");

const { catalogs } = (await import("../packages/i18n/src/catalog")) as {
  catalogs: Record<"en-US" | "zh-CN", Catalog>;
};

const enKeys = Object.keys(catalogs["en-US"]).sort();
const zhKeys = Object.keys(catalogs["zh-CN"]).sort();
const failures: string[] = [];

for (const key of diffKeys(enKeys, zhKeys)) {
  failures.push(`zh-CN missing key ${key}`);
}

for (const key of diffKeys(zhKeys, enKeys)) {
  failures.push(`en-US missing key ${key}`);
}

for (const key of enKeys.filter((candidate) => zhKeys.includes(candidate))) {
  const enPlaceholders = placeholders(catalogs["en-US"][key] ?? "");
  const zhPlaceholders = placeholders(catalogs["zh-CN"][key] ?? "");

  if (enPlaceholders.join(",") !== zhPlaceholders.join(",")) {
    failures.push(
      `${key} placeholder mismatch: en-US={${enPlaceholders.join(",")}} zh-CN={${zhPlaceholders.join(",")}}`,
    );
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("check-i18n: ok");
