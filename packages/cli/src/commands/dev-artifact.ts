import { ProjectError, readContractArtifact, resolveArtifactPath, type DevSession, type ResolvedDevSession } from "@consol/core";
import { runForgeBuild } from "@consol/foundry";
import type { BuildRequestResult } from "@consol/tui";
import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import { parseBuildDiagnostics } from "./diagnostics";
import type { DevRuntimeInput } from "./dev-runtime";
import { recordFromUnknown } from "./dev-unknown";

export async function executeDevBuild(input: DevRuntimeInput, session: DevSession): Promise<BuildRequestResult> {
  const build = await runForgeBuild({
    cwd: session.projectRoot,
    projectRoot: session.projectRoot,
    env: input.env,
  });
  const diagnostics = parseBuildDiagnostics(build.stdout, build.stderr);
  if (build.ok) {
    return {
      status: "ok",
      message: `Build ok: ${session.contract}`,
      diagnostics,
      stdout: build.stdout,
      stderr: build.stderr,
    };
  }

  return {
    status: "error",
    message: build.stderr.trim() || build.stdout.trim() || build.error,
    diagnostics,
    stdout: build.stdout,
    stderr: build.stderr,
  };
}

export async function ensureDevArtifact(input: DevRuntimeInput, prepared: ResolvedDevSession): Promise<void> {
  const buildMode = devArtifactBuildMode(prepared);
  if (buildMode === "ready") {
    return;
  }

  const build = await runForgeBuild({
    cwd: prepared.resolved.projectRoot,
    projectRoot: prepared.resolved.projectRoot,
    env: input.env,
    ...(buildMode === "force" ? { force: true } : {}),
  });
  if (!build.ok) {
    throw new ProjectError({
      code: "dev_build_failed",
      message: "Foundry build failed before launching dev.",
      hint: build.stderr.trim() || build.stdout.trim() || "Run `consol build` to inspect diagnostics.",
    });
  }
}

function devArtifactBuildMode(prepared: ResolvedDevSession): "ready" | "build" | "force" {
  try {
    const artifactPath = resolveArtifactPath(prepared.resolved);
    if (!existsSync(artifactPath)) {
      return "build";
    }

    const artifact = readContractArtifact(artifactPath);
    return artifact.bytecode === null ? "force" : "ready";
  } catch (error) {
    if (error instanceof ProjectError && error.code === "artifact_not_found") {
      return "build";
    }
    if (
      error instanceof ProjectError &&
      ["artifact_missing_abi", "artifact_source_mismatch", "target_ambiguous"].includes(error.code)
    ) {
      return "force";
    }
    throw error;
  }
}

export function detailContractIdentifier(rawArtifact: unknown, artifactPath: string, contractName: string): string {
  const source = detailArtifactSource(rawArtifact);
  if (source !== undefined) {
    return `${source}:${contractName}`;
  }

  return `src/${basename(dirname(artifactPath))}:${contractName}`;
}

function detailArtifactSource(rawArtifact: unknown): string | undefined {
  const metadata = recordFromUnknown(rawArtifact)?.["metadata"];
  const settings = recordFromUnknown(metadata)?.["settings"];
  const compilationTarget = recordFromUnknown(recordFromUnknown(settings)?.["compilationTarget"]);
  return compilationTarget === undefined ? undefined : Object.keys(compilationTarget)[0];
}
