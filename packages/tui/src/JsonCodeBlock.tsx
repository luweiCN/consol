/** @jsxImportSource @opentui/solid */
import type { ColorInput } from "@opentui/core";
import { theme } from "./theme";

type JsonToken = {
  readonly kind: "plain" | "key" | "string" | "number" | "literal" | "punctuation";
  readonly text: string;
};

export function JsonCodeBlock(props: { readonly lines: readonly string[] }) {
  return (
    <box
      width="100%"
      height={props.lines.length + 2}
      border
      borderStyle="rounded"
      borderColor={theme.color.border}
      backgroundColor={theme.color.surfaceRaised}
      flexDirection="column"
      paddingX={1}
    >
      {props.lines.map((line) => (
        <JsonCodeLine line={line} />
      ))}
    </box>
  );
}

export function formattedJsonLines(raw: string): readonly string[] | null {
  try {
    return JSON.stringify(JSON.parse(raw) as unknown, null, 2).split("\n");
  } catch {
    return null;
  }
}

function JsonCodeLine(props: { readonly line: string }) {
  return (
    <box width="100%" height={1} flexDirection="row">
      {jsonTokens(props.line).map((token) => (
        <text selectable flexShrink={0} fg={jsonTokenColor(token.kind)} content={token.text} wrapMode="none" />
      ))}
    </box>
  );
}

function jsonTokens(line: string): readonly JsonToken[] {
  const tokens: JsonToken[] = [];
  const pattern = /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|[{}[\]:,]/g;
  let cursor = 0;
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      tokens.push({ kind: "plain", text: line.slice(cursor, index) });
    }

    const text = match[0];
    tokens.push({
      kind: match[1] !== undefined
        ? "key"
        : match[2] !== undefined
          ? "string"
          : match[3] !== undefined
            ? "number"
            : match[4] !== undefined
              ? "literal"
              : "punctuation",
      text,
    });
    cursor = index + text.length;
  }

  if (cursor < line.length) {
    tokens.push({ kind: "plain", text: line.slice(cursor) });
  }

  return tokens.length === 0 ? [{ kind: "plain", text: line }] : tokens;
}

function jsonTokenColor(kind: JsonToken["kind"]): ColorInput {
  if (kind === "key") {
    return theme.color.type;
  }
  if (kind === "string") {
    return theme.color.string;
  }
  if (kind === "number") {
    return theme.color.number;
  }
  if (kind === "literal") {
    return theme.color.keyword;
  }
  if (kind === "punctuation") {
    return theme.color.muted;
  }
  return theme.color.code;
}
