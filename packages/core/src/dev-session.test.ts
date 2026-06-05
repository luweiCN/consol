import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createDevSession, resolveDevSession } from "./dev-session";

describe("dev session", () => {
  test("loads target and ABI summary from a Foundry artifact", () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-dev-session-")));
    writeCounterArtifact(projectRoot);

    expect(createDevSession({ cwd: projectRoot, target: "Counter" })).toMatchObject({
      target: "Counter",
      contract: "Counter",
      sourceMode: "project",
      projectRoot,
      sourceFile: "src/Counter.sol",
      sourceFiles: ["src/Counter.sol"],
      artifactPath: join(projectRoot, "out", "Counter.sol", "Counter.json"),
      abiSummary: {
        functions: 1,
        events: 0,
        errors: 0,
        constructor: false,
      },
      functions: [{ name: "number", signature: "number()" }],
    });
  });

  test("defaults to the first Solidity source contract when target is empty", () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-dev-session-default-")));
    writeCounterArtifact(projectRoot);

    expect(createDevSession({ cwd: projectRoot, target: "" })).toMatchObject({
      target: "src/Counter.sol:Counter",
      contract: "Counter",
      sourceFile: "src/Counter.sol",
      artifactPath: join(projectRoot, "out", "Counter.sol", "Counter.json"),
    });
  });

  test("defaults bare dev to a single Solidity file outside Foundry projects", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-dev-session-single-default-")));
    const sourceFile = join(root, "Counter.sol");
    writeFileSync(sourceFile, "contract Counter {}\n");

    const prepared = resolveDevSession({ cwd: root, target: "" });

    expect(prepared).toMatchObject({
      target: "Counter.sol:Counter",
      resolved: {
        sourceMode: "single_file",
        sourceFile,
        contractName: "Counter",
      },
    });
    expect(prepared.resolved.projectRoot).toContain(join(".cache", "consol", "scratch"));
  });

  test("asks for an explicit target when bare dev sees multiple non-Foundry Solidity contracts", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-dev-session-single-ambiguous-")));
    writeFileSync(join(root, "Counter.sol"), "contract Counter {}\n");
    writeFileSync(join(root, "Token.sol"), "contract Token {}\n");

    const error = captureError(() => resolveDevSession({ cwd: root, target: "" }));

    expect(error).toMatchObject({ code: "dev_source_contract_ambiguous" });
  });

  test("defaults to src contracts before scripts and dependency directories", () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-dev-session-default-priority-")));
    writeSimpleArtifact(projectRoot, "lib/Dependency.sol", "Dependency");
    writeSimpleArtifact(projectRoot, "script/Deploy.sol", "Deploy");
    writeCounterArtifact(projectRoot);

    expect(createDevSession({ cwd: projectRoot, target: "" })).toMatchObject({
      target: "src/Counter.sol:Counter",
      contract: "Counter",
      sourceFiles: ["src/Counter.sol", "script/Deploy.sol"],
    });
  });

  test("loads constructor inputs for deploy input previews", () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-dev-session-constructor-")));
    writeCounterArtifact(projectRoot, {
      constructorInputs: [{ name: "initial", type: "uint256" }],
    });

    expect(createDevSession({ cwd: projectRoot, target: "Counter" })).toMatchObject({
      abiSummary: {
        constructor: true,
      },
      constructor: {
        signature: "constructor(uint256)",
        inputs: [{ name: "initial", kind: "uint256" }],
      },
    });
  });

  test("lists Solidity source files for the dev files panel", () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-dev-session-files-")));
    writeCounterArtifact(projectRoot);
    writeFileSync(join(projectRoot, "src", "Other.sol"), "contract Other {}\n");

    expect(createDevSession({ cwd: projectRoot, target: "Counter" })).toMatchObject({
      sourceFile: "src/Counter.sol",
      sourceFiles: ["src/Counter.sol", "src/Other.sol"],
    });
  });

  test("lists selectable source targets for multi-contract files", () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-dev-session-targets-")));
    writeCounterArtifact(projectRoot);
    writeMultiArtifact(projectRoot, "src/Multi.sol", ["Alpha", "Beta"]);

    expect(createDevSession({ cwd: projectRoot, target: "Counter" })).toMatchObject({
      sourceTargets: [
        { sourceFile: "src/Counter.sol", contract: "Counter", target: "src/Counter.sol:Counter" },
        { sourceFile: "src/Multi.sol", contract: "Alpha", target: "src/Multi.sol:Alpha" },
        { sourceFile: "src/Multi.sol", contract: "Beta", target: "src/Multi.sol:Beta" },
      ],
    });
  });

  test("does not turn inherited contract wording in comments into source targets", () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-dev-session-comment-contracts-")));
    writeCounterArtifact(projectRoot);
    writeFileSync(
      join(projectRoot, "src", "Token.sol"),
      [
        "// Note: This contract inherits from MyToken",
        "contract MyFirstToken is ERC20 {",
        "}",
      ].join("\n"),
    );

    const session = createDevSession({ cwd: projectRoot, target: "Counter" });

    expect(session.sourceTargets).toContainEqual(expect.objectContaining({
      sourceFile: "src/Token.sol",
      contract: "MyFirstToken",
      target: "src/Token.sol:MyFirstToken",
      declarationKind: "contract",
      deployable: true,
      deployReason: null,
    }));
    expect(session.sourceTargets.map((target) => target.contract)).not.toContain("inherits");
  });

  test("orders dev functions by read, write, payable for the cockpit", () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), "consol-dev-session-function-kind-")));
    writeMixedFunctionArtifact(projectRoot);

    const session = createDevSession({ cwd: projectRoot, target: "Counter" });

    expect(session.functions.map((item) => `${item.kind}:${item.signature}`)).toEqual([
      "read:number()",
      "write:setNumber(uint256)",
      "payable:buy()",
    ]);
  });
});

function writeCounterArtifact(
  projectRoot: string,
  options: { readonly constructorInputs?: readonly { readonly name: string; readonly type: string }[] } = {},
): void {
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
  writeFileSync(join(projectRoot, "src", "Counter.sol"), "contract Counter { function number() external view returns (uint256) { return 1; } }\n");
  const artifactPath = join(projectRoot, "out", "Counter.sol", "Counter.json");
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(
    artifactPath,
    JSON.stringify({
      abi: [
        ...(options.constructorInputs === undefined
          ? []
          : [
              {
                type: "constructor",
                inputs: options.constructorInputs,
              },
            ]),
        {
          type: "function",
          name: "number",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "uint256" }],
        },
      ],
      bytecode: { object: "0x60016002" },
      metadata: {
        settings: {
          compilationTarget: {
            "src/Counter.sol": "Counter",
          },
        },
      },
    }),
  );
}

function captureError(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }

  throw new Error("expected function to throw");
}

function writeSimpleArtifact(projectRoot: string, source: string, contract: string): void {
  mkdirSync(dirname(join(projectRoot, source)), { recursive: true });
  writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
  writeFileSync(join(projectRoot, source), `contract ${contract} {}\n`);
  const artifactPath = join(projectRoot, "out", source.replace(/.*\//, ""), `${contract}.json`);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(
    artifactPath,
    JSON.stringify({
      abi: [],
      bytecode: { object: "0x6001" },
      metadata: {
        settings: {
          compilationTarget: {
            [source]: contract,
          },
        },
      },
    }),
  );
}

function writeMultiArtifact(projectRoot: string, source: string, contracts: readonly string[]): void {
  mkdirSync(dirname(join(projectRoot, source)), { recursive: true });
  writeFileSync(join(projectRoot, source), `${contracts.map((contract) => `contract ${contract} {}`).join("\n")}\n`);
  for (const contract of contracts) {
    const artifactPath = join(projectRoot, "out", source.replace(/.*\//, ""), `${contract}.json`);
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(
      artifactPath,
      JSON.stringify({
        abi: [],
        bytecode: { object: "0x6001" },
        metadata: {
          settings: {
            compilationTarget: {
              [source]: contract,
            },
          },
        },
      }),
    );
  }
}

function writeMixedFunctionArtifact(projectRoot: string): void {
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(join(projectRoot, "foundry.toml"), "[profile.default]\n");
  writeFileSync(
    join(projectRoot, "src", "Counter.sol"),
    "contract Counter { function buy() external payable {} function setNumber(uint256 value) external {} function number() external view returns (uint256) {} }\n",
  );
  const artifactPath = join(projectRoot, "out", "Counter.sol", "Counter.json");
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(
    artifactPath,
    JSON.stringify({
      abi: [
        {
          type: "function",
          name: "buy",
          stateMutability: "payable",
          inputs: [],
          outputs: [],
        },
        {
          type: "function",
          name: "setNumber",
          stateMutability: "nonpayable",
          inputs: [{ name: "value", type: "uint256" }],
          outputs: [],
        },
        {
          type: "function",
          name: "number",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "uint256" }],
        },
      ],
      bytecode: { object: "0x6001" },
      metadata: {
        settings: {
          compilationTarget: {
            "src/Counter.sol": "Counter",
          },
        },
      },
    }),
  );
}
