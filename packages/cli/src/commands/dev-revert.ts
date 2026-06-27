import { decodeRevertError, listScratchProjectRoots, readContractArtifact, singleFileScratchRoot, type DevSession } from "@consol/core";
import { deploymentEntries } from "./deploy-cache";
import { devSessionForDeployment } from "./dev-deployments";

// Custom errors can bubble up from a contract the active session never names
// (e.g. BigBankAdmin.adminWithdraw reverts with Bank's InsufficientBalance).
// Collect error definitions from the current contract plus every distinct
// contract deployed across scratch roots so a revert can be decoded regardless
// of which contract defined the error.
function knownErrorAbi(session: DevSession): readonly unknown[] {
  const errors: unknown[] = [];
  const seenError = new Set<string>();
  const seenContract = new Set<string>([session.contract]);
  const addArtifactErrors = (artifactPath: string): void => {
    let abi: readonly unknown[];
    try {
      abi = readContractArtifact(artifactPath).abi;
    } catch {
      return;
    }
    for (const item of abi) {
      if (!isErrorAbiItem(item)) {
        continue;
      }
      const key = errorAbiKey(item);
      if (!seenError.has(key)) {
        seenError.add(key);
        errors.push(item);
      }
    }
  };

  addArtifactErrors(session.artifactPath);
  const roots = new Set<string>([session.projectRoot]);
  if (session.sourceMode === "single_file") {
    for (const root of listScratchProjectRoots(singleFileScratchRoot())) {
      roots.add(root);
    }
  }
  for (const projectRoot of roots) {
    for (const entry of deploymentEntries(projectRoot)) {
      if (seenContract.has(entry.contract)) {
        continue;
      }
      seenContract.add(entry.contract);
      const contractSession = devSessionForDeployment(session, entry, projectRoot);
      if (contractSession !== null) {
        addArtifactErrors(contractSession.artifactPath);
      }
    }
  }
  return errors;
}

function isErrorAbiItem(
  item: unknown,
): item is { readonly name: string; readonly inputs?: readonly { readonly type: string }[] } {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as { type?: unknown }).type === "error" &&
    typeof (item as { name?: unknown }).name === "string"
  );
}

function errorAbiKey(item: { readonly name: string; readonly inputs?: readonly { readonly type: string }[] }): string {
  return `${item.name}(${(item.inputs ?? []).map((input) => input.type).join(",")})`;
}

// Prepends the decoded custom error (when recognized) to the raw RPC message so
// the picker shows both the human-readable error and the original selector/data.
export function enrichRevertError(errorText: string, session: DevSession): string {
  const decoded = decodeRevertError(errorText, knownErrorAbi(session));
  return decoded === null ? errorText : `${decoded} — ${errorText}`;
}
