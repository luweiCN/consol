import { terminalCellWidth, wrapTerminalText } from "./terminal-width";

export type WrappablePreviewLine = {
  readonly text: string;
};

export function wrapPreviewLines<T extends WrappablePreviewLine>(lines: readonly T[], width: number): readonly T[] {
  return lines.flatMap((line) => wrapPreviewLine(line, width));
}

function wrapPreviewLine<T extends WrappablePreviewLine>(line: T, width: number): readonly T[] {
  if (line.text.length === 0 || terminalCellWidth(line.text) <= width) {
    return [line];
  }

  const labelEnd = line.text.indexOf(": ");
  const indent = labelEnd < 0 ? "  " : " ".repeat(Math.min(labelEnd + 2, Math.max(2, width - 4)));
  return wrapTerminalText(line.text, width, indent).map((text) => ({ ...line, text }));
}
