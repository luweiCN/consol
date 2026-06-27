import { describe, expect, test } from "bun:test";
import type { ContractArtifact } from "@consol/core";
import { parseLibraryOverrides, resolveLibraries, type LibraryResolver } from "./deploy-libraries";

describe("parseLibraryOverrides", () => {
  test("parses Name:0xAddr pairs into a name->address map", () => {
    const map = parseLibraryOverrides(["MathLib:0xabc", "StrLib:0xdef"]);
    expect(map.get("MathLib")).toBe("0xabc");
    expect(map.get("StrLib")).toBe("0xdef");
  });

  test("supports three-part source:Name:0xAddr by keying on Name", () => {
    const map = parseLibraryOverrides(["src/MathLib.sol:MathLib:0xabc"]);
    expect(map.get("MathLib")).toBe("0xabc");
  });

  test("throws on malformed input", () => {
    expect(() => parseLibraryOverrides(["MathLib"])).toThrow();
  });
});

function artifact(linkReferences: readonly { source: string; name: string }[]): ContractArtifact {
  return {
    path: "out/x.json",
    abi: [],
    abiSummary: { functions: 0, events: 0, errors: 0, constructor: false },
    bytecode: "0x60",
    linkReferences,
    bytecodeHash: "h",
    compilerGasEstimates: null,
    raw: {},
  };
}

function recordingResolver(overrides?: Partial<LibraryResolver>): LibraryResolver & { deployed: string[] } {
  const deployed: string[] = [];
  return {
    deployed,
    loadArtifact: () => artifact([]),
    resolveCached: async () => null,
    deploy: async (req) => {
      deployed.push(req.name);
      return `0x${req.name}`;
    },
    ...overrides,
  };
}

describe("resolveLibraries", () => {
  test("returns empty when the artifact needs no libraries", async () => {
    const resolver = recordingResolver();
    expect(await resolveLibraries(artifact([]), new Map(), resolver)).toEqual([]);
    expect(resolver.deployed).toEqual([]);
  });

  test("deploys a required library and links it by source:name:address", async () => {
    const resolver = recordingResolver();
    const links = await resolveLibraries(
      artifact([{ source: "src/MathLib.sol", name: "MathLib" }]),
      new Map(),
      resolver,
    );
    expect(links).toEqual([{ source: "src/MathLib.sol", name: "MathLib", address: "0xMathLib" }]);
    expect(resolver.deployed).toEqual(["MathLib"]);
  });

  test("reuses a cached library address instead of deploying", async () => {
    const resolver = recordingResolver({ resolveCached: async () => "0xCACHED" });
    const links = await resolveLibraries(
      artifact([{ source: "src/MathLib.sol", name: "MathLib" }]),
      new Map(),
      resolver,
    );
    expect(links[0]?.address).toBe("0xCACHED");
    expect(resolver.deployed).toEqual([]);
  });

  test("user-provided address wins and skips deploy", async () => {
    const resolver = recordingResolver();
    const links = await resolveLibraries(
      artifact([{ source: "src/MathLib.sol", name: "MathLib" }]),
      new Map([["MathLib", "0xUSER"]]),
      resolver,
    );
    expect(links[0]?.address).toBe("0xUSER");
    expect(resolver.deployed).toEqual([]);
  });

  test("deploys nested dependency before its dependent (topological order)", async () => {
    const resolver = recordingResolver({
      loadArtifact: (req) =>
        req.name === "Outer" ? artifact([{ source: "src/Inner.sol", name: "Inner" }]) : artifact([]),
    });
    const links = await resolveLibraries(
      artifact([{ source: "src/Outer.sol", name: "Outer" }]),
      new Map(),
      resolver,
    );
    expect(resolver.deployed).toEqual(["Inner", "Outer"]);
    expect(links.map((link) => link.name)).toEqual(["Outer"]);
  });

  test("detects circular dependencies", async () => {
    const resolver = recordingResolver({
      loadArtifact: (req) =>
        req.name === "A"
          ? artifact([{ source: "src/B.sol", name: "B" }])
          : artifact([{ source: "src/A.sol", name: "A" }]),
    });
    await expect(
      resolveLibraries(artifact([{ source: "src/A.sol", name: "A" }]), new Map(), resolver),
    ).rejects.toThrow();
  });
});
