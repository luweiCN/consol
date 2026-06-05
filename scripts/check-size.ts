import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["packages", "scripts"];
const LIMIT = 350;
const INTEGRATION_LIMITS: Readonly<Record<string, { readonly limit: number; readonly reason: string }>> = {
  "packages/cli/src/commands/dev.ts": {
    limit: 1800,
    reason: "dev TUI launch and RPC bridge orchestration; split after release readiness review",
  },
  "packages/tui/src/DevShell.tsx": {
    limit: 1450,
    reason: "OpenTUI shell layout and keyboard orchestration; split after interaction coverage is broader",
  },
  "packages/tui/src/DevShellController.tsx": {
    limit: 1100,
    reason: "stateful TUI controller boundary; split after controller regression tests are reviewed",
  },
  "packages/tui/src/DevPanels.tsx": {
    limit: 1100,
    reason: "panel component bundle kept stable for release-prep; extract panels in a dedicated pass",
  },
};

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function collectFiles(root: string): string[] {
  if (!exists(root)) {
    return [];
  }

  const entries = readdirSync(root);
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      if (["node_modules", "dist", "coverage"].includes(entry)) {
        continue;
      }
      files.push(...collectFiles(path));
      continue;
    }

    if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      files.push(path);
    }
  }

  return files;
}

function isSkipped(path: string): boolean {
  return (
    path.includes("/fixtures/") ||
    path.includes("/snapshots/") ||
    path.endsWith(".test.ts") ||
    path.endsWith(".test.tsx") ||
    path.endsWith(".spec.ts") ||
    path.endsWith(".spec.tsx")
  );
}

const failures: string[] = [];

for (const file of ROOTS.flatMap(collectFiles)) {
  if (isSkipped(file)) {
    continue;
  }

  const relativePath = relative(process.cwd(), file);
  const integrationLimit = INTEGRATION_LIMITS[relativePath];
  const limit = integrationLimit?.limit ?? LIMIT;
  const lines = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;

  if (lines > limit) {
    failures.push(`${relativePath} has ${lines} non-empty lines; limit is ${limit}${integrationLimit === undefined ? "" : ` (${integrationLimit.reason})`}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("check-size: ok");
