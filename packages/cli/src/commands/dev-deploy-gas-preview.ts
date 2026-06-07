import { ProjectError, readContractArtifact, resolveArtifactPath, resolveTarget } from "@consol/core";
import { runCastEstimateCreate } from "@consol/foundry";
import type { AccountMeta, TxPreviewEvent } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv } from "../main";

export type DeployGasPreviewInput = {
  readonly env: CliEnv;
  readonly cwd: string;
  readonly target: string;
  readonly globals?: GlobalArgs;
  readonly rpcUrl: string;
  readonly account: AccountMeta;
  readonly action: "deploy" | "redeploy";
  readonly signature: string;
  readonly args: readonly string[];
  readonly value: string | null;
  readonly gasLimit?: string | null;
};

export async function createDeployGasPreview(input: DeployGasPreviewInput): Promise<TxPreviewEvent["gas"]> {
  const baseContext = {
    ...(input.action === "redeploy" ? { fresh: true } : {}),
    ...(input.gasLimit == null ? {} : { gasLimit: input.gasLimit }),
  };

  try {
    const resolved = resolveTarget({
      cwd: input.cwd,
      target: input.target,
      ...(input.globals?.project === undefined ? {} : { projectRoot: input.globals.project }),
    });
    const artifact = readContractArtifact(resolveArtifactPath(resolved));
    if (artifact.bytecode === null) {
      throw new ProjectError({
        code: "artifact_missing_bytecode",
        message: "Artifact has no deployable bytecode.",
        hint: "Run `consol build` and check that the target is a deployable contract.",
      });
    }

    const gas = await runCastEstimateCreate({
      cwd: resolved.projectRoot,
      env: input.env,
      rpcUrl: input.rpcUrl,
      bytecode: artifact.bytecode,
      signature: input.signature,
      constructorArgs: input.args,
      ...(input.account.address === null ? {} : { from: input.account.address }),
      ...(input.value === null ? {} : { value: input.value }),
    });

    return {
      source: "rpc_estimate",
      ...(gas.ok ? { estimate: gas.stdout.trim() } : {}),
      confidence: gas.ok ? "medium" : "low",
      context: {
        ...baseContext,
        ...(gas.ok ? {} : { error: gas.stderr.trim() || gas.stdout.trim() || gas.error }),
      },
    };
  } catch (error) {
    return {
      source: "rpc_estimate",
      confidence: "low",
      context: {
        ...baseContext,
        error: errorMessage(error),
      },
    };
  }
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const hint = error instanceof ProjectError ? error.hint : undefined;
  return hint === undefined || hint.length === 0 ? error.message : `${error.message}\n${hint}`;
}
