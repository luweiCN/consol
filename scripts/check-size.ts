import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["packages", "scripts"];
const LIMIT = 350;
const INTEGRATION_LIMITS: Readonly<Record<string, { readonly limit: number; readonly reason: string }>> = {
  "packages/cli/src/commands/dev.ts": {
    limit: 520,
    reason: "dev TUI launch orchestration and snapshot/callback wiring; deployment/revert/event-watch/state/records/tx-preview/tx-confirm extracted into sibling dev-* modules with shared helpers in dev-runtime/dev-unknown",
  },
  "packages/cli/src/commands/dev-tx-preview.ts": {
    limit: 440,
    reason: "tx read/send/deploy preview generation plus tx-preview event shaping; cohesive preview pipeline kept together",
  },
  "packages/cli/src/commands/dev-tx-confirm.ts": {
    limit: 420,
    reason: "tx confirm execution plus receipt/transaction-record enrichment via RPC; cohesive confirm pipeline kept together",
  },
  "packages/cli/src/commands/chain.ts": {
    limit: 620,
    reason: "local Anvil lifecycle plus save/restore/reset state RPC flow; split state snapshot storage after TUI workflow stabilizes",
  },
  "packages/cli/src/commands/interact.ts": {
    limit: 420,
    reason: "read/state command bridge includes ABI readers plus storage-state assembly; split state command after complex state release",
  },
  "packages/cli/src/commands/storage-state.ts": {
    limit: 420,
    reason: "storage layout summary/detail assembly is kept together until array/struct/mapping behavior stabilizes",
  },
  "packages/testkit/src/fake-foundry.ts": {
    limit: 380,
    reason: "fake Foundry integration fixture covers build, inspect, and storage-layout outputs for CLI tests",
  },
  "packages/tui/src/DevShell.tsx": {
    limit: 2020,
    reason: "OpenTUI shell layout, keyboard orchestration, state detail/key book flow, and local chain state modal flow; split state/network controllers next",
  },
  "packages/tui/src/DevShellController.tsx": {
    limit: 1150,
    reason: "stateful TUI controller boundary, local chain reset clearing, live event-push callback, and trace request wiring; split after controller regression tests are reviewed",
  },
  "packages/i18n/src/locales/en-US.ts": {
    limit: 380,
    reason: "locale message table grows with each user-facing feature",
  },
  "packages/i18n/src/locales/zh-CN.ts": {
    limit: 380,
    reason: "locale message table grows with each user-facing feature",
  },
  "packages/tui/src/DevPanels.tsx": {
    limit: 1200,
    reason: "panel component bundle kept stable for release-prep; extract state and transaction panels in a dedicated pass",
  },
  "packages/tui/src/runtime-types.ts": {
    limit: 380,
    reason: "shared runtime snapshot/handler type table grows with each dev feature",
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
