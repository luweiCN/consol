export type WrappablePreviewLine = {
  readonly text: string;
};

export function wrapPreviewLines<T extends WrappablePreviewLine>(lines: readonly T[], width: number): readonly T[] {
  return lines.flatMap((line) => wrapPreviewLine(line, width));
}

export function terminalCellWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    width += isWideTerminalCodePoint(char.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

function wrapPreviewLine<T extends WrappablePreviewLine>(line: T, width: number): readonly T[] {
  if (line.text.length === 0 || terminalCellWidth(line.text) <= width) {
    return [line];
  }

  const labelEnd = line.text.indexOf(": ");
  const indent = labelEnd < 0 ? "  " : " ".repeat(Math.min(labelEnd + 2, Math.max(2, width - 4)));
  return wrapText(line.text, width, indent).map((text) => ({ ...line, text }));
}

function wrapText(text: string, width: number, indent: string): readonly string[] {
  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;

  for (const char of text) {
    const charWidth = terminalCellWidth(char);
    if (current.length > 0 && currentWidth + charWidth > width) {
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
  return WIDE_TERMINAL_CODE_POINT_RANGES.some(function isInRange(range) {
    return Math.max(range[0] - codePoint, codePoint - range[1]) <= 0;
  });
}

const WIDE_TERMINAL_CODE_POINT_RANGES: readonly (readonly [number, number])[] = [
  [0x2E80, 0xA4CF],
  [0xAC00, 0xD7A3],
  [0xF900, 0xFAFF],
  [0xFE10, 0xFE6F],
  [0xFF00, 0xFF60],
  [0xFFE0, 0xFFE6],
];
