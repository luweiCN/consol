/** @jsxImportSource @opentui/solid */
import { createMemo } from "solid-js";
import { CodeBlock, type CodeToken } from "./CodeBlock";
import { soliditySyntaxStyle, solidityTreeSitterClientForPreview } from "./SolidityTreeSitter";
import { theme } from "./theme";

const solidityKeywords = new Set([
  "abstract",
  "as",
  "break",
  "calldata",
  "constant",
  "constructor",
  "continue",
  "contract",
  "delete",
  "do",
  "else",
  "emit",
  "enum",
  "event",
  "external",
  "for",
  "function",
  "if",
  "immutable",
  "import",
  "indexed",
  "interface",
  "internal",
  "is",
  "library",
  "mapping",
  "memory",
  "modifier",
  "new",
  "override",
  "payable",
  "pragma",
  "private",
  "public",
  "pure",
  "return",
  "returns",
  "storage",
  "struct",
  "type",
  "using",
  "view",
  "virtual",
  "while",
]);

const solidityValueKeywords = new Set(["false", "null", "super", "this", "true"]);
const solidityFixedTypes = new Set(["address", "bool", "bytes", "int", "string", "uint"]);
const tokenPattern = /(\/\/.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b0x[a-fA-F0-9]+\b|\b\d+(?:\.\d+)?\b)|([{}()[\];:,.=+\-*/<>!&|%^~?])|([A-Za-z_]\w*)|(\s+)|(.+)/gy;

export function SolidityCodePreview(props: {
  readonly lines: readonly string[];
  readonly wrapColumn?: number;
}) {
  const rows = createMemo(() => props.lines.map(previewRow));
  const content = createMemo(() => rows().map((row) => row.code).join("\n"));
  const firstLineNumber = createMemo(() => rows().find((row) => row.lineNumber !== null)?.lineNumber ?? 1);
  const treeSitterClient = solidityTreeSitterClientForPreview();

  if (treeSitterClient !== undefined) {
    return (
      <CodeBlock
        id="solidity-preview"
        content={content()}
        filetype="solidity"
        syntaxStyle={soliditySyntaxStyle}
        treeSitterClient={treeSitterClient}
        firstLineNumber={firstLineNumber()}
        border={false}
      />
    );
  }

  return (
    <CodeBlock
      id="solidity-preview"
      content={content()}
      firstLineNumber={firstLineNumber()}
      border={false}
      wrapColumn={props.wrapColumn ?? 72}
      tokenizeLine={solidityCodeTokens}
    />
  );
}

function solidityCodeTokens(line: string): readonly CodeToken[] {
  const tokens: CodeToken[] = [];
  tokenPattern.lastIndex = 0;

  for (const match of line.matchAll(tokenPattern)) {
    const text = match[0];
    if (match[1] !== undefined) {
      tokens.push({ text, fg: theme.color.comment });
      continue;
    }
    if (match[2] !== undefined) {
      tokens.push({ text, fg: theme.color.string });
      continue;
    }
    if (match[3] !== undefined) {
      tokens.push({ text, fg: theme.color.number });
      continue;
    }
    if (match[4] !== undefined) {
      tokens.push({ text, fg: theme.color.muted });
      continue;
    }
    if (match[5] !== undefined) {
      const endIndex = (match.index ?? 0) + text.length;
      tokens.push({ text, fg: solidityIdentifierColor(text, line, endIndex) });
      continue;
    }

    tokens.push({ text, fg: theme.color.code });
  }

  return tokens.length === 0 ? [{ text: line, fg: theme.color.code }] : tokens;
}

function solidityIdentifierColor(identifier: string, line: string, nextIndex: number): CodeToken["fg"] {
  if (solidityKeywords.has(identifier)) {
    return theme.color.keyword;
  }
  if (solidityValueKeywords.has(identifier)) {
    return theme.color.number;
  }
  if (isSolidityType(identifier)) {
    return theme.color.type;
  }
  if (nextNonWhitespaceCharacter(line, nextIndex) === "(") {
    return theme.color.accent;
  }
  return theme.color.code;
}

function isSolidityType(identifier: string): boolean {
  return solidityFixedTypes.has(identifier) || /^u?int(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)$/.test(identifier) || /^bytes(?:[1-9]|[12][0-9]|3[0-2])$/.test(identifier);
}

function nextNonWhitespaceCharacter(value: string, start: number): string {
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (character !== undefined && !/\s/.test(character)) {
      return character;
    }
  }
  return "";
}

function previewRow(line: string): { readonly lineNumber: number | null; readonly code: string } {
  const pipeMatch = line.match(/^\s*(\d+)\s+\|\s?(.*)$/);
  if (pipeMatch !== null) {
    return { lineNumber: Number(pipeMatch[1] ?? 0), code: pipeMatch[2] ?? "" };
  }

  const spacedMatch = line.match(/^\s*(\d+) {3}(.*)$/);
  return spacedMatch === null ? { lineNumber: null, code: line } : { lineNumber: Number(spacedMatch[1] ?? 0), code: spacedMatch[2] ?? "" };
}
