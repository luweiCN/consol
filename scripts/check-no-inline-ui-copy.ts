import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const TUI_SRC = "packages/tui/src";
const VISIBLE_TEXT = /[A-Za-z\u4E00-\u9FFF]/;
const TEXT_NODE = />[ \t]*([^<>{}\n][^<>{}\n]*)[ \t]*</g;
const TEXT_PROP = /\b(content|title|label|placeholder)=["']([^"']*[A-Za-z\u4E00-\u9FFF][^"']*)["']/g;

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function collectTsx(root: string): string[] {
  if (!exists(root)) {
    return [];
  }

  const files: string[] = [];

  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      files.push(...collectTsx(path));
      continue;
    }

    if (path.endsWith(".tsx")) {
      files.push(path);
    }
  }

  return files;
}

const failures: string[] = [];

for (const file of collectTsx(TUI_SRC)) {
  const source = readFileSync(file, "utf8");

  for (const match of source.matchAll(TEXT_NODE)) {
    const text = (match[1] ?? "").trim();
    if (VISIBLE_TEXT.test(text)) {
      failures.push(`${relative(process.cwd(), file)} has inline JSX text "${text}"`);
    }
  }

  for (const match of source.matchAll(TEXT_PROP)) {
    failures.push(`${relative(process.cwd(), file)} has inline ${match[1]} copy "${match[2]}"`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("check-no-inline-ui-copy: ok");
