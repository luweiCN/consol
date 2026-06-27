import { ProjectError } from "@consol/core";

export function parseRequiredCreateField(stdout: string, pattern: RegExp, code: string): string {
  const value = parseOptionalCreateField(stdout, pattern);
  if (value !== null) {
    return value;
  }

  throw new ProjectError({
    code,
    message: "forge create output did not include the deployed address.",
    hint: "Re-run forge create directly to inspect the raw deployment output.",
  });
}

export function parseOptionalCreateField(stdout: string, pattern: RegExp): string | null {
  const match = pattern.exec(stdout);
  const value = match?.[1];
  return value === undefined ? null : value;
}

export function hasCode(value: string): boolean {
  const code = value.trim();
  return code.length > 0 && code !== "0x";
}
