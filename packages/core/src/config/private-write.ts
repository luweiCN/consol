import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function writePrivateFile(path: string, contents: string): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  writeFileSync(path, contents, { mode: 0o600 });
  chmodSync(path, 0o600);
}
