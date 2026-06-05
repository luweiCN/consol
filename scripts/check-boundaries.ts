import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

type Rule = {
  readonly root: string;
  readonly banned: readonly RegExp[];
};

const rules: readonly Rule[] = [
  {
    root: "packages/protocol/src",
    banned: [/@consol\/(?:core|foundry|tui|cli)\b/],
  },
  {
    root: "packages/core/src",
    banned: [/@opentui\//, /@consol\/(?:foundry|rpc|tui|cli)\b/, /\bnode:child_process\b/, /\bchild_process\b/],
  },
  {
    root: "packages/rpc/src",
    banned: [/@opentui\//, /@consol\/(?:foundry|tui|cli)\b/, /\bnode:child_process\b/, /\bchild_process\b/],
  },
  {
    root: "packages/tui/src",
    banned: [/\bnode:child_process\b/, /\bchild_process\b/, /\bspawn\s*\(/, /\bexec\s*\(/, /\bexecFile\s*\(/],
  },
  {
    root: "packages/i18n/src",
    banned: [/@consol\/(?:core|foundry|tui|cli)\b/],
  },
];

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function collectSourceFiles(root: string): string[] {
  if (!exists(root)) {
    return [];
  }

  const files: string[] = [];

  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(path));
      continue;
    }

    if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      files.push(path);
    }
  }

  return files;
}

const failures: string[] = [];

for (const rule of rules) {
  for (const file of collectSourceFiles(rule.root)) {
    const source = readFileSync(file, "utf8");

    for (const banned of rule.banned) {
      if (banned.test(source)) {
        failures.push(`${relative(process.cwd(), file)} violates boundary rule ${banned}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("check-boundaries: ok");
