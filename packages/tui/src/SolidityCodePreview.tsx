/** @jsxImportSource @opentui/solid */
import { addDefaultParsers, getDataPaths, SyntaxStyle, TreeSitterClient, type FiletypeParserOptions } from "@opentui/core";
import bundledTreeSitterWorker from "../../../node_modules/@opentui/core/parser.worker.js" with { type: "file" };
import solidityHighlights from "tree-sitter-solidity/queries/highlights.scm" with { type: "file" };
import solidityWasm from "tree-sitter-solidity/tree-sitter-solidity.wasm" with { type: "file" };
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createMemo } from "solid-js";
import { CodeBlock } from "./CodeBlock";
import { theme } from "./theme";

let solidityParserRegistered = false;
let solidityTreeSitterClient: TreeSitterClient | undefined;

const soliditySyntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: theme.color.code },
  comment: { fg: theme.color.comment, dim: true },
  constant: { fg: theme.color.number },
  constructor: { fg: theme.color.keyword, bold: true },
  field: { fg: theme.color.type },
  function: { fg: theme.color.accent },
  include: { fg: theme.color.keyword },
  keyword: { fg: theme.color.keyword, bold: true },
  number: { fg: theme.color.number },
  operator: { fg: theme.color.muted },
  parameter: { fg: theme.color.text },
  property: { fg: theme.color.type },
  punctuation: { fg: theme.color.muted },
  repeat: { fg: theme.color.keyword },
  string: { fg: theme.color.string },
  tag: { fg: theme.color.muted },
  type: { fg: theme.color.type },
  variable: { fg: theme.color.text },
});

export function SolidityCodePreview(props: { readonly lines: readonly string[] }) {
  ensureSolidityParser();
  const rows = createMemo(() => props.lines.map(previewRow));
  const content = createMemo(() => rows().map((row) => row.code).join("\n"));
  const firstLineNumber = createMemo(() => rows().find((row) => row.lineNumber !== null)?.lineNumber ?? 1);

  return (
    <CodeBlock
      id="solidity-preview"
      content={content()}
      filetype="solidity"
      syntaxStyle={soliditySyntaxStyle}
      treeSitterClient={solidityTreeSitterClientForPreview()}
      firstLineNumber={firstLineNumber()}
      border={false}
    />
  );
}

function ensureSolidityParser(): void {
  if (solidityParserRegistered) {
    return;
  }

  const client = solidityTreeSitterClientForPreview();
  const solidityParser = solidityParserOptions();
  addDefaultParsers([solidityParser]);
  client.addFiletypeParser(solidityParser);
  solidityParserRegistered = true;
}

function solidityTreeSitterClientForPreview(): TreeSitterClient {
  if (solidityTreeSitterClient !== undefined) {
    return solidityTreeSitterClient;
  }

  solidityTreeSitterClient = new TreeSitterClient({
    dataPath: getDataPaths().globalDataPath,
    workerPath: solidityTreeSitterWorkerPath(),
  });
  return solidityTreeSitterClient;
}

function solidityParserOptions(): FiletypeParserOptions {
  const highlights = findNodeModuleFile(["tree-sitter-solidity", "queries", "highlights.scm"]) ?? solidityHighlights;
  const wasm = findNodeModuleFile(["tree-sitter-solidity", "tree-sitter-solidity.wasm"]) ?? solidityWasm;
  return {
    filetype: "solidity",
    aliases: ["sol"],
    queries: {
      highlights: [highlights],
    },
    wasm,
  };
}

function solidityTreeSitterWorkerPath(): string {
  return findNodeModuleFile(["@opentui", "core", "parser.worker.js"]) ?? bundledTreeSitterWorker;
}

function findNodeModuleFile(parts: readonly string[]): string | null {
  for (const start of nodeModuleSearchStarts()) {
    let directory = resolve(start);
    for (let depth = 0; depth < 10; depth += 1) {
      const candidate = join(directory, "node_modules", ...parts);
      if (existsSync(candidate)) {
        return candidate;
      }

      const parent = dirname(directory);
      if (parent === directory) {
        break;
      }
      directory = parent;
    }
  }

  return null;
}

function nodeModuleSearchStarts(): readonly string[] {
  return [
    dirname(process.argv[0] ?? ""),
    process.cwd(),
    import.meta.dir,
  ].filter((value) => value.length > 0);
}

function previewRow(line: string): { readonly lineNumber: number | null; readonly code: string } {
  const pipeMatch = line.match(/^\s*(\d+)\s+\|\s?(.*)$/);
  if (pipeMatch !== null) {
    return { lineNumber: Number(pipeMatch[1] ?? 0), code: pipeMatch[2] ?? "" };
  }

  const spacedMatch = line.match(/^\s*(\d+) {3}(.*)$/);
  return spacedMatch === null ? { lineNumber: null, code: line } : { lineNumber: Number(spacedMatch[1] ?? 0), code: spacedMatch[2] ?? "" };
}
