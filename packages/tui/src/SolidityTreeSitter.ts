import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addDefaultParsers, clearEnvCache, getDataPaths, RGBA, SyntaxStyle, TreeSitterClient, type FiletypeParserOptions } from "@opentui/core";
import parserWorkerSource from "../../../node_modules/@opentui/core/parser.worker.js" with { type: "text" };
import webTreeSitterSource from "../../../node_modules/web-tree-sitter/tree-sitter.js" with { type: "text" };
import solidityHighlightsSource from "tree-sitter-solidity/queries/highlights.scm" with { type: "text" };
import solidityWasmAsset from "tree-sitter-solidity/tree-sitter-solidity.wasm" with { type: "file" };
import webTreeSitterWasmAsset from "web-tree-sitter/tree-sitter.wasm" with { type: "file" };

type TreeSitterRuntimeAssets = {
  readonly workerPath: string;
  readonly solidityWasmPath: string;
  readonly solidityHighlightsPath: string;
};

const assetVersion = "v1";
const workerImport = 'import { Parser, Query, Language } from "web-tree-sitter";';
const workerRelativeImport = 'import { Parser, Query, Language } from "./web-tree-sitter/tree-sitter.js";';

let solidityParserRegistered = false;
let solidityTreeSitterClient: TreeSitterClient | undefined;
let runtimeAssets: TreeSitterRuntimeAssets | undefined;

export const solidityCodeTokenColor = {
  foreground: RGBA.defaultForeground(),
  white: RGBA.defaultForeground(),
  comment: RGBA.fromIndex(2),
  function: RGBA.fromIndex(4),
  keyword: RGBA.fromIndex(5),
  operator: RGBA.fromIndex(6),
  property: RGBA.fromIndex(4),
  string: RGBA.fromIndex(3),
  type: RGBA.fromIndex(6),
} as const;

export const soliditySyntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: solidityCodeTokenColor.foreground },
  comment: { fg: solidityCodeTokenColor.comment },
  constant: { fg: solidityCodeTokenColor.foreground },
  constructor: { fg: solidityCodeTokenColor.keyword, bold: true },
  field: { fg: solidityCodeTokenColor.property },
  function: { fg: solidityCodeTokenColor.function },
  "keyword.function": { fg: solidityCodeTokenColor.keyword, bold: true },
  keyword: { fg: solidityCodeTokenColor.keyword, bold: true },
  "keyword.return": { fg: solidityCodeTokenColor.keyword, bold: true },
  number: { fg: solidityCodeTokenColor.foreground },
  operator: { fg: solidityCodeTokenColor.operator },
  parameter: { fg: solidityCodeTokenColor.function },
  property: { fg: solidityCodeTokenColor.property },
  punctuation: { fg: solidityCodeTokenColor.operator },
  "punctuation.bracket": { fg: solidityCodeTokenColor.operator },
  repeat: { fg: solidityCodeTokenColor.keyword },
  string: { fg: solidityCodeTokenColor.string },
  tag: { fg: solidityCodeTokenColor.operator },
  type: { fg: solidityCodeTokenColor.type },
  variable: { fg: solidityCodeTokenColor.foreground },
});

export function solidityTreeSitterClientForPreview(): TreeSitterClient | undefined {
  try {
    ensureSolidityParser();
    return solidityTreeSitterClient;
  } catch (error) {
    console.error(`TreeSitter asset setup failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function ensureSolidityParser(): void {
  if (solidityParserRegistered) {
    return;
  }

  const client = solidityTreeSitterClientForPreviewInternal();
  const parser = solidityParserOptions();
  addDefaultParsers([parser]);
  client.addFiletypeParser(parser);
  solidityParserRegistered = true;
}

function solidityTreeSitterClientForPreviewInternal(): TreeSitterClient {
  if (solidityTreeSitterClient !== undefined) {
    return solidityTreeSitterClient;
  }

  const assets = ensureTreeSitterRuntimeAssets();
  solidityTreeSitterClient = new TreeSitterClient({
    dataPath: getDataPaths().globalDataPath,
    workerPath: assets.workerPath,
  });
  return solidityTreeSitterClient;
}

function solidityParserOptions(): FiletypeParserOptions {
  const assets = ensureTreeSitterRuntimeAssets();
  return {
    filetype: "solidity",
    aliases: ["sol"],
    queries: {
      highlights: [assets.solidityHighlightsPath],
    },
    wasm: assets.solidityWasmPath,
  };
}

function ensureTreeSitterRuntimeAssets(): TreeSitterRuntimeAssets {
  if (runtimeAssets !== undefined) {
    configureOpenTuiDefaultWorkerPath(runtimeAssets.workerPath);
    return runtimeAssets;
  }

  const root = join(getDataPaths().globalDataPath, "consol", "tree-sitter-preview", assetVersion);
  const webTreeSitterRoot = join(root, "web-tree-sitter");
  mkdirSync(webTreeSitterRoot, { recursive: true });

  const workerPath = join(root, "parser.worker.js");
  const webTreeSitterPath = join(webTreeSitterRoot, "tree-sitter.js");
  const webTreeSitterWasmPath = join(webTreeSitterRoot, "tree-sitter.wasm");
  const solidityWasmPath = join(root, "tree-sitter-solidity.wasm");
  const solidityHighlightsPath = join(root, "highlights.scm");

  writeFileSync(workerPath, patchedParserWorkerSource(), { mode: 0o600 });
  writeFileSync(webTreeSitterPath, webTreeSitterSource, { mode: 0o600 });
  writeFileSync(webTreeSitterWasmPath, readFileSync(webTreeSitterWasmAsset), { mode: 0o600 });
  writeFileSync(solidityWasmPath, readFileSync(solidityWasmAsset), { mode: 0o600 });
  writeFileSync(solidityHighlightsPath, solidityHighlightsSource, { mode: 0o600 });

  runtimeAssets = {
    workerPath,
    solidityWasmPath,
    solidityHighlightsPath,
  };
  configureOpenTuiDefaultWorkerPath(workerPath);
  return runtimeAssets;
}

function configureOpenTuiDefaultWorkerPath(workerPath: string): void {
  process.env.OTUI_TREE_SITTER_WORKER_PATH = workerPath;
  (globalThis as typeof globalThis & { OTUI_TREE_SITTER_WORKER_PATH?: string }).OTUI_TREE_SITTER_WORKER_PATH = workerPath;
  clearEnvCache();
}

function patchedParserWorkerSource(): string {
  if (!parserWorkerSource.includes(workerImport)) {
    throw new Error("OpenTUI parser worker import shape changed");
  }

  return parserWorkerSource
    .replace(workerImport, workerRelativeImport)
    .replaceAll("web-tree-sitter/tree-sitter.wasm", "./web-tree-sitter/tree-sitter.wasm");
}
