import {
  runForgeInspectStorageLayout,
  type FoundryCommandOptions,
  type FoundryCommandResult,
} from "@consol/foundry";

export type InspectStorageLayoutInput = FoundryCommandOptions & {
  readonly contractId: string;
};

export async function runForgeInspectStorageLayoutWithCacheRecovery(
  input: InspectStorageLayoutInput,
): Promise<FoundryCommandResult> {
  const result = await runForgeInspectStorageLayout(input);
  if (result.ok || !isMissingStorageLayoutArtifact(result)) {
    return result;
  }

  return runForgeInspectStorageLayout({
    ...input,
    force: true,
  });
}

export function foundryResultMessage(result: FoundryCommandResult): string {
  const stderr = result.stderr.trim();
  if (stderr.length > 0) {
    return stderr;
  }

  const stdout = result.stdout.trim();
  if (stdout.length > 0) {
    return stdout;
  }

  return result.ok ? "" : result.error;
}

function fullFoundryResultMessage(result: FoundryCommandResult): string {
  const error = result.ok ? "" : result.error;
  return [result.stderr, result.stdout, error].filter((part) => part.trim().length > 0).join("\n");
}

function isMissingStorageLayoutArtifact(result: FoundryCommandResult): boolean {
  return fullFoundryResultMessage(result).includes("storage layout missing from artifact");
}
