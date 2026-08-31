const wideTerminalCodePointRanges = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0x303e],
  [0x3040, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
] as const;

export function terminalCellWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    width += isWideTerminalCodePoint(char.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

export function wrapTerminalText(value: string, width: number, continuationIndent = ""): readonly string[] {
  if (value.length === 0) {
    return [""];
  }

  const maxWidth = Math.max(1, width);
  if (terminalCellWidth(value) <= maxWidth) {
    return [value];
  }

  const indent = terminalCellWidth(continuationIndent) < maxWidth ? continuationIndent : "";
  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;

  for (const char of value) {
    const charWidth = terminalCellWidth(char);
    if (current.length > 0 && currentWidth + charWidth > maxWidth) {
      lines.push(current);
      current = indent;
      currentWidth = terminalCellWidth(indent);
    }
    current += char;
    currentWidth += charWidth;
  }

  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

function isWideTerminalCodePoint(codePoint: number): boolean {
  return wideTerminalCodePointRanges.some(([start, end]) => start <= codePoint && codePoint <= end);
}
