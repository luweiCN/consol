export type BuildDiagnostic = {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly code: string | null;
  readonly file: string | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly source: "forge build";
};

type PendingDiagnostic = {
  readonly severity: BuildDiagnostic["severity"];
  readonly message: string;
  readonly code: string | null;
};

type Location = {
  readonly file: string;
  readonly line: number;
  readonly column: number;
};

export function parseBuildDiagnostics(stdout: string, stderr: string): readonly BuildDiagnostic[] {
  const diagnostics: BuildDiagnostic[] = [];
  let pending: PendingDiagnostic | null = null;

  for (const rawLine of stdout.split(/\r?\n/).concat(stderr.split(/\r?\n/))) {
    const line = stripAnsi(rawLine).trim();
    if (line.length === 0 || line === "Error: Compiler run failed:") {
      continue;
    }

    const next = parseDiagnosticMessage(line);
    if (next !== null) {
      if (pending !== null) {
        diagnostics.push(diagnosticFromPending(pending, null));
      }
      pending = next;
      continue;
    }

    const location = parseLocation(line);
    if (location !== null && pending !== null) {
      diagnostics.push(diagnosticFromPending(pending, location));
      pending = null;
    }
  }

  if (pending !== null) {
    diagnostics.push(diagnosticFromPending(pending, null));
  }

  return diagnostics;
}

function diagnosticFromPending(pending: PendingDiagnostic, location: Location | null): BuildDiagnostic {
  return {
    severity: pending.severity,
    message: pending.message,
    code: pending.code,
    file: location?.file ?? null,
    line: location?.line ?? null,
    column: location?.column ?? null,
    source: "forge build",
  };
}

function parseDiagnosticMessage(line: string): PendingDiagnostic | null {
  for (const { prefix, severity } of [
    { prefix: "Error", severity: "error" },
    { prefix: "Warning", severity: "warning" },
  ] as const) {
    if (!line.startsWith(prefix)) {
      continue;
    }

    const rest = line.slice(prefix.length).trimStart();
    if (rest.startsWith("(")) {
      const codeAndMessage = splitOnce(rest.slice(1), "):");
      if (codeAndMessage === null) {
        continue;
      }
      const [code, message] = codeAndMessage;
      return {
        severity,
        message: message.trim(),
        code: code.trim(),
      };
    }

    if (rest.startsWith(":")) {
      return {
        severity,
        message: rest.slice(1).trim(),
        code: null,
      };
    }
  }

  return null;
}

function parseLocation(line: string): Location | null {
  const locationText = locationCandidate(line);
  if (locationText === null) {
    return null;
  }

  const location = trimLocationSuffix(locationText);
  const pathAndLineColumn = rsplitOnce(location, ":");
  if (pathAndLineColumn === null) {
    return null;
  }
  const [pathAndLine, columnText] = pathAndLineColumn;
  const fileLine = rsplitOnce(pathAndLine, ":");
  if (fileLine === null) {
    return null;
  }
  const [file, lineText] = fileLine;
  const lineNumber = Number.parseInt(lineText.trim(), 10);
  const columnNumber = Number.parseInt(columnText.trim(), 10);
  if (!Number.isInteger(lineNumber) || !Number.isInteger(columnNumber)) {
    return null;
  }

  return {
    file: file.trim(),
    line: lineNumber,
    column: columnNumber,
  };
}

function locationCandidate(line: string): string | null {
  if (line.startsWith("-->")) {
    return line.slice(3);
  }

  const boxedPrefix = "\u256d\u2500[";
  if (line.startsWith(boxedPrefix)) {
    return line.slice(boxedPrefix.length);
  }

  const marker = " --> ";
  const markerIndex = line.indexOf(marker);
  if (markerIndex !== -1) {
    return line.slice(markerIndex + marker.length);
  }

  return null;
}

function trimLocationSuffix(value: string): string {
  let trimmed = value.trim();
  while (trimmed.endsWith("]") || trimmed.endsWith(":")) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }
  return trimmed.trim();
}

function stripAnsi(value: string): string {
  let output = "";
  let index = 0;
  while (index < value.length) {
    if (value.charCodeAt(index) === 27 && value[index + 1] === "[") {
      index += 2;
      while (index < value.length) {
        const code = value.charCodeAt(index);
        index += 1;
        if (code >= 64 && code <= 126) {
          break;
        }
      }
      continue;
    }

    output += value[index] ?? "";
    index += 1;
  }
  return output;
}

function splitOnce(value: string, separator: string): readonly [string, string] | null {
  const index = value.indexOf(separator);
  if (index === -1) {
    return null;
  }
  return [value.slice(0, index), value.slice(index + separator.length)];
}

function rsplitOnce(value: string, separator: string): readonly [string, string] | null {
  const index = value.lastIndexOf(separator);
  if (index === -1) {
    return null;
  }
  return [value.slice(0, index), value.slice(index + separator.length)];
}
