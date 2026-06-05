import { resolveTarget } from "@consol/core";
import { runForgeBuild, runForgeTest } from "@consol/foundry";
import { createSuccessEnvelope } from "@consol/protocol";
import type { GlobalArgs } from "../args";
import type { CliEnv, CliResult } from "../main";
import { VERSION } from "../version";
import { parseBuildDiagnostics, type BuildDiagnostic } from "./diagnostics";

export type AnalyzeFinding = {
  readonly severity: "error" | "warning";
  readonly source: string;
  readonly message: string;
  readonly file: string | null;
  readonly line: number | null;
  readonly column: number | null;
};

export type AnalyzeData = {
  readonly project_root: string;
  readonly status: "success" | "failed";
  readonly build_status: "success" | "failed";
  readonly test_status: "success" | "failed";
  readonly diagnostics: readonly BuildDiagnostic[];
  readonly findings: readonly AnalyzeFinding[];
  readonly test_stdout: string;
  readonly test_stderr: string;
};

export type RunAnalyzeCommandInput = {
  readonly globals: GlobalArgs;
  readonly commandArgs: readonly string[];
  readonly cwd: string;
  readonly env: CliEnv;
};

export async function runAnalyzeCommand(input: RunAnalyzeCommandInput): Promise<CliResult> {
  const resolved = resolveTarget({
    cwd: input.cwd,
    ...(input.globals.project === undefined ? {} : { projectRoot: input.globals.project }),
  });
  const build = await runForgeBuild({
    cwd: resolved.projectRoot,
    projectRoot: resolved.projectRoot,
    env: input.env,
  });
  const test = await runForgeTest({
    cwd: resolved.projectRoot,
    projectRoot: resolved.projectRoot,
    env: input.env,
  });
  const diagnostics = parseBuildDiagnostics(build.stdout, build.stderr);
  const findings = diagnostics.map(findingFromDiagnostic);
  if (!test.ok) {
    findings.push({
      severity: "error",
      source: "forge test",
      message: "Foundry tests failed.",
      file: null,
      line: null,
      column: null,
    });
  }

  const data: AnalyzeData = {
    project_root: resolved.projectRoot,
    status: build.ok && test.ok && !findings.some((finding) => finding.severity === "error") ? "success" : "failed",
    build_status: build.ok ? "success" : "failed",
    test_status: test.ok ? "success" : "failed",
    diagnostics,
    findings,
    test_stdout: test.stdout,
    test_stderr: test.stderr,
  };

  if (input.globals.json || input.commandArgs.includes("--json")) {
    const envelope = createSuccessEnvelope({
      data,
      meta: {
        version: VERSION,
        command: "analyze",
        project_root: data.project_root,
      },
    });
    return { exitCode: data.status === "success" ? 0 : 1, stdout: `${JSON.stringify(envelope, null, 2)}\n`, stderr: "" };
  }

  if (data.status === "success") {
    return { exitCode: 0, stdout: `Analysis passed: ${data.project_root}\n`, stderr: "" };
  }

  return {
    exitCode: 1,
    stdout: formatHumanFindings(data),
    stderr: "ConSol analysis found issues.\n",
  };
}

function findingFromDiagnostic(diagnostic: BuildDiagnostic): AnalyzeFinding {
  return {
    severity: diagnostic.severity,
    source: diagnostic.source,
    message: diagnostic.message,
    file: diagnostic.file,
    line: diagnostic.line,
    column: diagnostic.column,
  };
}

function formatHumanFindings(data: AnalyzeData): string {
  const lines = [`Analysis failed: ${data.project_root}`, `  build: ${data.build_status}`, `  test: ${data.test_status}`];
  for (const finding of data.findings) {
    lines.push(`  ${finding.severity} ${findingLocation(finding)} ${finding.message}`);
  }
  return `${lines.join("\n")}\n`;
}

function findingLocation(finding: AnalyzeFinding): string {
  if (finding.file !== null && finding.line !== null && finding.column !== null) {
    return `${finding.file}:${finding.line}:${finding.column}`;
  }
  return finding.file ?? finding.source;
}
