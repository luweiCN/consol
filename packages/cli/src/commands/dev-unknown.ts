export function recordFromUnknown(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
}

export function arrayFromUnknown(raw: unknown): readonly unknown[] {
  return Array.isArray(raw) ? raw : [];
}

export function stringFromUnknown(raw: unknown): string | undefined {
  return typeof raw === "string" ? raw : undefined;
}

export function booleanFromUnknown(raw: unknown): boolean | undefined {
  return typeof raw === "boolean" ? raw : undefined;
}

export function nullableStringFromUnknown(raw: unknown): string | null {
  return raw === null ? null : stringFromUnknown(raw) ?? null;
}

export function nullableScalarStringFromUnknown(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  switch (typeof raw) {
    case "string":
      return raw;
    case "number":
    case "bigint":
    case "boolean":
      return String(raw);
    default:
      return null;
  }
}

export function numberFromUnknown(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

export function rawEventString(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

export function eventCreatedAtUnix(timestamp: string): number {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? Math.floor(Date.now() / 1000) : Math.floor(date.getTime() / 1000);
}
