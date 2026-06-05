import type { DevSession } from "@consol/core";

export type DevSessionActionContext = {
  readonly cwd: string;
  readonly target: string;
};

export function devSessionActionContext(session: DevSession): DevSessionActionContext {
  if (session.sourceMode === "single_file") {
    const sourceFile = session.sourceFile ?? "";
    return {
      cwd: session.projectRoot,
      target: sourceFile.length === 0 ? session.target : `${sourceFile}:${session.contract}`,
    };
  }

  return {
    cwd: session.projectRoot,
    target: session.target,
  };
}
