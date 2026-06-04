import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverDevWorkspaces } from "./dev-discovery";

describe("dev workspace discovery", () => {
  test("reports nearest Foundry project without scanning child workspaces", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-dev-discovery-foundry-")));
    writeFoundryContract(root, "src/Counter.sol", "Counter");
    writeStandaloneContract(root, "examples/Example.sol", "Example");

    expect(discoverDevWorkspaces({ cwd: join(root, "src") })).toEqual({
      kind: "foundry_project",
      projectRoot: root,
    });
  });

  test("discovers child Foundry projects and standalone contracts from a non-project root", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-dev-discovery-workspace-")));
    const foundryRoot = join(root, "foundry-app");
    writeFoundryContract(foundryRoot, "src/Token.sol", "Token");
    writeStandaloneContract(root, "lessons/Foo.sol", "Foo");

    expect(discoverDevWorkspaces({ cwd: root })).toEqual({
      kind: "workspace",
      root,
      candidates: [
        {
          kind: "foundry_project",
          label: "foundry-app",
          projectRoot: foundryRoot,
        },
        {
          kind: "standalone_contract",
          contract: "Foo",
          declarationKind: "contract",
          deployable: true,
          deployReason: null,
          label: "lessons/Foo.sol:Foo",
          sourceFile: join(root, "lessons", "Foo.sol"),
          target: "lessons/Foo.sol:Foo",
          workspaceRoot: root,
        },
      ],
    });
  });

  test("returns standalone contract candidates for a non-Foundry contract directory", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-dev-discovery-standalone-")));
    writeStandaloneContract(root, "A.sol", "Alpha");
    writeStandaloneContract(root, "B.sol", "Beta");

    expect(discoverDevWorkspaces({ cwd: root })).toMatchObject({
      kind: "workspace",
      candidates: [
        { kind: "standalone_contract", label: "A.sol:Alpha", target: "A.sol:Alpha" },
        { kind: "standalone_contract", label: "B.sol:Beta", target: "B.sol:Beta" },
      ],
    });
  });

  test("ignores contract words in comments when discovering standalone contracts", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "consol-dev-discovery-comments-")));
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "Token.sol"),
      [
        "// Note: This contract inherits from MyToken",
        "/* contract Ghost {} */",
        "contract MyFirstToken is ERC20 {",
        "}",
      ].join("\n"),
    );

    expect(discoverDevWorkspaces({ cwd: root })).toMatchObject({
      kind: "workspace",
      candidates: [
        {
          kind: "standalone_contract",
          contract: "MyFirstToken",
          label: "Token.sol:MyFirstToken",
          target: "Token.sol:MyFirstToken",
        },
      ],
    });
  });
});

function writeFoundryContract(root: string, source: string, contract: string): void {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "foundry.toml"), "[profile.default]\n");
  writeFileSync(join(root, source), `contract ${contract} {}\n`);
}

function writeStandaloneContract(root: string, source: string, contract: string): void {
  mkdirSync(join(root, source, ".."), { recursive: true });
  writeFileSync(join(root, source), `contract ${contract} {}\n`);
}
