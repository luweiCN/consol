import { decodeRevertError } from "./revert-error";

export type SimulationOutcome = {
  readonly ok: boolean;
  readonly returnValue: string | null;
  readonly reason: string | null;
};

/**
 * Interprets a `cast call` (eth_call dry-run) result as a pre-send simulation:
 * a successful call's return value, or a reverting call's decoded reason
 * (falling back to the raw message when no error in `errorAbi` matches).
 */
export function simulationOutcome(
  call: { readonly ok: boolean; readonly stdout: string; readonly stderr: string; readonly error?: string },
  errorAbi: readonly unknown[],
): SimulationOutcome {
  if (call.ok) {
    const out = call.stdout.trim();
    return { ok: true, returnValue: out.length > 0 ? out : null, reason: null };
  }

  const text = call.stderr.trim() || call.error?.trim() || call.stdout.trim();
  return {
    ok: false,
    returnValue: null,
    reason: decodeRevertError(text, errorAbi) ?? (text.length > 0 ? text : null),
  };
}
