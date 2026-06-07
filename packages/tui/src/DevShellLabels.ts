import type { DevSession } from "@consol/core";
import type { MessageKey } from "@consol/i18n";

export function displaySourceFile(session: DevSession | undefined): string | null {
  if (session === undefined) {
    return null;
  }

  const activeTarget = session.sourceTargets.find((target) => target.target === session.target);
  if (activeTarget !== undefined) {
    return activeTarget.sourceFile;
  }

  if (session.sourceFile !== null) {
    const activeContractInSource = session.sourceTargets.find((target) =>
      target.sourceFile === session.sourceFile && target.contract === session.contract
    );
    if (activeContractInSource !== undefined) {
      return activeContractInSource.sourceFile;
    }
  }

  const targetSource = sourceFileFromTarget(session.target);
  if (targetSource.endsWith(".sol") && session.sourceTargets.some((target) => target.sourceFile === targetSource)) {
    return targetSource;
  }

  const contractMatches = session.sourceTargets.filter((target) => target.contract === session.contract);
  if (contractMatches.length === 1) {
    return contractMatches[0]?.sourceFile ?? null;
  }

  if (session.sourceFile !== null) {
    return session.sourceFile;
  }

  if (targetSource.endsWith(".sol")) {
    return targetSource;
  }

  return session.sourceFile;
}

export function contractPanelTitle(
  _session: DevSession | undefined,
  translate: (key: MessageKey, values?: Record<string, string | number>) => string,
): string {
  return translate("tui.panel.compileDeploy");
}

function sourceFileFromTarget(target: string): string {
  return target.split(":")[0] ?? target;
}
