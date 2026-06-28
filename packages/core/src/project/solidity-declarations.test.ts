import { describe, expect, test } from "bun:test";
import { solidityDeclarations } from "./solidity-declarations";

describe("Solidity declaration parser", () => {
  test("preserves source order and ignores comments and strings", () => {
    const source = [
      "pragma solidity ^0.8.20;",
      "// contract GhostComment {}",
      "string constant SAMPLE = 'interface GhostString {} library GhostLib {}';",
      "interface IDemo { function touch() external; }",
      "abstract",
      "contract BaseDemo { function base() external virtual; }",
      "library HelperLib { function x() internal pure returns (uint256) { return 1; } }",
      "contract FeatureDemo is BaseDemo { function touch() external {} }",
    ].join("\n");

    expect(solidityDeclarations(source)).toEqual([
      {
        name: "IDemo",
        kind: "interface",
        deployable: false,
        deployReason: "interface declarations do not have deployable bytecode",
      },
      {
        name: "BaseDemo",
        kind: "abstract",
        deployable: false,
        deployReason: "abstract contracts do not have deployable bytecode",
      },
      {
        name: "HelperLib",
        kind: "library",
        deployable: true,
        deployReason: null,
      },
      {
        name: "FeatureDemo",
        kind: "contract",
        deployable: true,
        deployReason: null,
      },
    ]);
  });
});
