/** @jsxImportSource @opentui/solid */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { SolidityCodePreview } from "./SolidityCodePreview";
import { solidityCodeTokenColor } from "./SolidityTreeSitter";

describe("SolidityCodePreview", () => {
  test("renders Solidity preview with highlighted spans", async () => {
    const setup = await testRender(
      () => <SolidityCodePreview lines={['  31   function getOwner() public view returns(address) { return "owner"; }']} />,
      { width: 96, height: 4 },
    );
    await setup.flush();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await setup.renderOnce();
    await setup.flush();

    const codeColors = () => setup.captureSpans().lines.flatMap((line) =>
      line.spans
        .filter((span) => span.text.trim().length > 0 && !/^\d+$/.test(span.text.trim()))
        .map((span) => span.fg.toString()),
    );

    const frame = setup.captureCharFrame();
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans);
    const functionNameSpan = spans.find((span) => span.text === "getOwner");
    const keywordSpan = spans.find((span) => span.text === "function");
    const stringSpan = spans.find((span) => span.text === '"owner"');
    expect(frame).toContain("function getOwner()");
    expect(frame).toContain("31");
    expect(new Set(codeColors()).size).toBeGreaterThan(1);
    expect(functionNameSpan?.fg.toString()).toBe(solidityCodeTokenColor.function.toString());
    expect(keywordSpan?.fg.toString()).toBe(solidityCodeTokenColor.keyword.toString());
    expect(stringSpan?.fg.toString()).toBe(solidityCodeTokenColor.string.toString());
  });

  test("keeps source indentation from numbered preview lines", async () => {
    const setup = await testRender(
      () => (
        <SolidityCodePreview
          lines={[
            "  12   contract Vault {",
            "  13       uint256 public total;",
            "  14   }",
          ]}
        />
      ),
      { width: 64, height: 6 },
    );
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("12");
    expect(frame).toContain("13");
    expect(frame).toContain("    uint256 public total;");
  });

  test("wraps long Solidity lines inside the preview", async () => {
    const setup = await testRender(
      () => (
        <SolidityCodePreview
          wrapColumn={48}
          lines={[
            "  88   function extremelyLongFunctionName(address firstAccount, address secondAccount, uint256 amount, string memory wrappedMarker) external {}",
          ]}
        />
      ),
      { width: 48, height: 8 },
    );
    await setup.flush();

    expect(setup.captureCharFrame()).toContain("wrappedMarker");
  });

  test("uses packaged OpenTUI tree-sitter assets for Solidity highlighting", () => {
    const previewSource = readFileSync(new URL("./SolidityCodePreview.tsx", import.meta.url), "utf8");
    const assetSource = readFileSync(new URL("./SolidityTreeSitter.ts", import.meta.url), "utf8");

    expect(previewSource).toContain("solidityTreeSitterClientForPreview");
    expect(assetSource).toContain("TreeSitterClient");
    expect(assetSource).toContain("parser.worker.js");
    expect(assetSource).toContain("web-tree-sitter");
    expect(assetSource).toContain("tree-sitter-solidity");
    expect(assetSource).toContain("OTUI_TREE_SITTER_WORKER_PATH");
    expect(assetSource).toContain("clearEnvCache");
  });
});
