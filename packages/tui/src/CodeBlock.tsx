/** @jsxImportSource @opentui/solid */
import { SyntaxStyle, type ColorInput, type TreeSitterClient } from "@opentui/core";
import { createMemo } from "solid-js";
import { theme } from "./theme";

export type CodeToken = {
  readonly text: string;
  readonly fg: ColorInput;
};

export function CodeBlock(props: {
  readonly id?: string;
  readonly content: string;
  readonly filetype?: string;
  readonly syntaxStyle?: SyntaxStyle;
  readonly treeSitterClient?: TreeSitterClient;
  readonly firstLineNumber?: number;
  readonly border?: boolean;
  readonly wrapColumn?: number;
  readonly tokenizeLine?: (line: string) => readonly CodeToken[];
}) {
  if (props.tokenizeLine !== undefined) {
    return <TokenizedCodeBlock {...props} tokenizeLine={props.tokenizeLine} />;
  }

  return <RenderedCodeBlock {...props} />;
}

const plainSyntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: theme.color.code },
});

function RenderedCodeBlock(props: {
  readonly id?: string;
  readonly content: string;
  readonly filetype?: string;
  readonly syntaxStyle?: SyntaxStyle;
  readonly treeSitterClient?: TreeSitterClient;
  readonly firstLineNumber?: number;
  readonly border?: boolean;
}) {
  const lines = createMemo(() => props.content.split("\n"));
  const firstLineNumber = createMemo(() => props.firstLineNumber ?? 1);
  const lineNumberOffset = createMemo(() => firstLineNumber() - 1);
  const gutterWidth = createMemo(() => Math.max(3, String(firstLineNumber() + Math.max(0, lines().length - 1)).length));
  const body = () => (
    <line_number
      {...(props.id === undefined ? {} : { id: `${props.id}-lines` })}
      width="100%"
      height="auto"
      fg={theme.color.codeLineNo}
      minWidth={gutterWidth()}
      paddingRight={1}
      lineNumberOffset={lineNumberOffset()}
    >
      <code
        {...(props.id === undefined ? {} : { id: `${props.id}-code` })}
        selectable
        content={props.content}
        {...(props.filetype === undefined ? {} : { filetype: props.filetype })}
        syntaxStyle={props.syntaxStyle ?? plainSyntaxStyle}
        {...(props.treeSitterClient === undefined ? {} : { treeSitterClient: props.treeSitterClient })}
        width="100%"
        height="auto"
        flexGrow={1}
        wrapMode="word"
        conceal={false}
        drawUnstyledText
        tabIndicator={2}
      />
    </line_number>
  );

  if (props.border === false) {
    return body();
  }

  return (
    <box
      {...(props.id === undefined ? {} : { id: props.id })}
      width="100%"
      height="auto"
      border
      borderStyle="rounded"
      borderColor={theme.color.border}
      paddingX={1}
    >
      {body()}
    </box>
  );
}

function TokenizedCodeBlock(props: {
  readonly id?: string;
  readonly content: string;
  readonly firstLineNumber?: number;
  readonly border?: boolean;
  readonly wrapColumn?: number;
  readonly tokenizeLine: (line: string) => readonly CodeToken[];
}) {
  const lines = createMemo(() => props.content.split("\n"));
  const firstLineNumber = createMemo(() => props.firstLineNumber ?? 1);
  const gutterWidth = createMemo(() => Math.max(3, String(firstLineNumber() + Math.max(0, lines().length - 1)).length));
  const codeWidth = createMemo(() => Math.max(8, (props.wrapColumn ?? 96) - gutterWidth() - 1));
  const rows = createMemo(() => lines().flatMap((line, index) =>
    wrapTokens(props.tokenizeLine(line), codeWidth()).map((tokens, visualIndex) => ({
      lineNumber: visualIndex === 0 ? firstLineNumber() + index : null,
      tokens,
    })),
  ));
  const body = () => (
    <box width="100%" height={rows().length} flexDirection="column">
      {rows().map((row) => (
        <box height={1} flexDirection="row">
          <text
            flexShrink={0}
            fg={theme.color.codeLineNo}
            content={row.lineNumber === null ? " ".repeat(gutterWidth()) : String(row.lineNumber).padStart(gutterWidth())}
            wrapMode="none"
          />
          <text flexShrink={0} fg={theme.color.codeLineNo} content=" " wrapMode="none" />
          {row.tokens.map((token) => (
            <text selectable flexShrink={0} fg={token.fg} content={token.text} wrapMode="none" />
          ))}
        </box>
      ))}
    </box>
  );

  if (props.border === false) {
    return body();
  }

  return (
    <box
      {...(props.id === undefined ? {} : { id: props.id })}
      width="100%"
      height={rows().length + 2}
      border
      borderStyle="rounded"
      borderColor={theme.color.border}
      paddingX={1}
      flexDirection="column"
    >
      {body()}
    </box>
  );
}

function wrapTokens(tokens: readonly CodeToken[], width: number): readonly (readonly CodeToken[])[] {
  if (tokens.length === 0) {
    return [[]];
  }

  const rows: CodeToken[][] = [];
  let current: CodeToken[] = [];
  let column = 0;

  const flush = () => {
    rows.push(current);
    current = [];
    column = 0;
  };

  for (const token of tokens) {
    let remainingText = token.text;
    while (remainingText.length > 0) {
      const remainingWidth = width - column;
      if (remainingWidth <= 0) {
        flush();
        continue;
      }

      if (column > 0 && remainingText.length > remainingWidth && remainingText.trim().length > 0) {
        flush();
        continue;
      }

      if (remainingText.length <= remainingWidth) {
        current.push({ ...token, text: remainingText });
        column += remainingText.length;
        remainingText = "";
        continue;
      }

      const cut = wrapCutIndex(remainingText, remainingWidth);
      current.push({ ...token, text: remainingText.slice(0, cut) });
      remainingText = remainingText.slice(cut);
      column += cut;
      flush();
    }
  }

  if (current.length > 0 || rows.length === 0) {
    rows.push(current);
  }

  return rows;
}

function wrapCutIndex(text: string, width: number): number {
  if (width <= 1) {
    return 1;
  }

  const slice = text.slice(0, width + 1);
  const space = slice.lastIndexOf(" ");
  if (space !== -1 && space !== 0 && space !== width) {
    return space + 1;
  }

  return width;
}
