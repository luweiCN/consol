/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { CodeBlock, type CodeToken } from "./CodeBlock";
import { formattedJsonLines, JsonCodeBlock } from "./JsonCodeBlock";

describe("CodeBlock", () => {
  test("renders JSON with line numbers, highlighting, and wrapped long values", async () => {
    const lines = formattedJsonLines(JSON.stringify({
      ok: true,
      data: {
        payload: `${"alpha ".repeat(14)}wrapped-marker`,
        count: 2,
      },
    }));
    if (lines === null) {
      throw new Error("expected valid JSON fixture");
    }

    const setup = await testRender(
      () => <JsonCodeBlock lines={lines} wrapColumn={34} />,
      {
        width: 40,
        height: 16,
      },
    );
    await setup.flush();

    const frame = setup.captureCharFrame();
    const colors = setup.captureSpans().lines.flatMap((line) =>
      line.spans
        .filter((span) => span.text.trim().length > 0 && !/^\d+$/.test(span.text.trim()))
        .map((span) => span.fg.toString()),
    );

    expect(frame).toContain("  1 ");
    expect(frame).toContain("  2 ");
    expect(frame).toContain("\"payload\"");
    expect(frame).toContain("wrapped-marker");
    expect(new Set(colors).size).toBeGreaterThan(1);
  });

  test("wraps before a token instead of splitting it when a row already has content", async () => {
    const wrappingFixture = ["alpha", " ", "public"].join("");
    const setup = await testRender(
      () => (
        <CodeBlock
          content={wrappingFixture}
          wrapColumn={12}
          tokenizeLine={(line): readonly CodeToken[] => line.split(/(\s+)/).filter(Boolean).map((text) => ({ text, fg: "white" }))}
        />
      ),
      {
        width: 20,
        height: 8,
      },
    );
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("alpha");
    expect(frame).toContain("public");
    expect(frame).not.toContain("pu\n");
  });
});
