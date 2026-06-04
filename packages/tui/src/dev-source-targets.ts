import type { DevSession } from "@consol/core";

export function initialSourceTargetIndex(session: DevSession | undefined): number {
  const sourceTargets = session?.sourceTargets ?? [];
  const activeIndex = sourceTargets.findIndex((target) => target.target === session?.target);
  if (activeIndex >= 0) {
    return activeIndex;
  }

  const sourceFile = session?.sourceFile;
  const contractIndex =
    sourceFile === null || sourceFile === undefined
      ? -1
      : sourceTargets.findIndex((target) => target.sourceFile === sourceFile && target.contract === session?.contract);
  if (contractIndex >= 0) {
    return contractIndex;
  }

  const sourceIndex = sourceFile === null || sourceFile === undefined ? -1 : sourceTargets.findIndex((target) => target.sourceFile === sourceFile);
  return sourceIndex >= 0 ? sourceIndex : 0;
}
