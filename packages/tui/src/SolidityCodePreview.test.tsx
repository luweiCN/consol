/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { SolidityCodePreview } from "./SolidityCodePreview";

describe("SolidityCodePreview", () => {
  test("renders Solidity preview with highlighted spans", async () => {
    const setup = await testRender(
      () => <SolidityCodePreview lines={['  31   function getOwner() public view returns(address) { return "owner"; }']} />,
      { width: 96, height: 4 },
    );
    await setup.flush();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await setup.renderOnce();
    await setup.flush();

    const codeColors = () => setup.captureSpans().lines.flatMap((line) =>
      line.spans
        .filter((span) => span.text.trim().length > 0 && !/^\d+$/.test(span.text.trim()))
        .map((span) => span.fg.toString()),
    );

    const frame = setup.captureCharFrame();
    expect(frame).toContain("function getOwner()");
    expect(frame).toContain("31");
    expect(new Set(codeColors()).size).toBeGreaterThan(1);
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
});
