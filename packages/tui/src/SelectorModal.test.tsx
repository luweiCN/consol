/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { SelectorModal } from "./SelectorModal";
import { theme } from "./theme";

const selectorTitle = "Selector";
const selectorHint = "→ actions";
const selectorSearch = "search";
const alphaLabel = "Alpha.sol";
const alphaMeta = "Counter";
const betaLabel = "Beta.sol";
const betaMeta = "Bank";

describe("SelectorModal", () => {
  test("applies selection background only to the selected option row", async () => {
    const setup = await testRender(
      () => (
        <SelectorModal
          id="selector"
          inputId="selector-input"
          optionIdPrefix="selector-option"
          title={selectorTitle}
          hint={selectorHint}
          searchPlaceholder={selectorSearch}
          query=""
          options={[
            { name: "alpha", label: alphaLabel, active: false, meta: alphaMeta },
            { name: "beta", label: betaLabel, active: true, meta: betaMeta },
          ]}
          selectedIndex={1}
          left={1}
          top={1}
          width={54}
          height={12}
          onQueryChange={() => {}}
          onSelect={() => {}}
        />
      ),
      { width: 70, height: 18 },
    );
    await setup.flush();

    const selectionBg = theme.background.selection.toString();
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans);
    const alphaSpans = spans.filter((span) => span.text.includes(alphaLabel) || span.text.includes(alphaMeta));
    const betaSpans = spans.filter((span) => span.text.includes(betaLabel) || span.text.includes(betaMeta));

    expect(alphaSpans.length).toBeGreaterThan(0);
    expect(betaSpans.length).toBeGreaterThan(0);
    expect(alphaSpans.some((span) => span.bg?.toString() === selectionBg)).toBe(false);
    expect(betaSpans.some((span) => span.bg?.toString() === selectionBg)).toBe(true);
  });

  test("clears the previous selected option background in the next frame buffer", async () => {
    const [selectedIndex, setSelectedIndex] = createSignal(0);
    const setup = await testRender(
      () => (
        <SelectorModal
          id="selector"
          inputId="selector-input"
          optionIdPrefix="selector-option"
          title={selectorTitle}
          hint={selectorHint}
          searchPlaceholder={selectorSearch}
          query=""
          options={[
            { name: "alpha", label: alphaLabel, active: true, meta: alphaMeta },
            { name: "beta", label: betaLabel, active: false, meta: betaMeta },
          ]}
          selectedIndex={selectedIndex()}
          left={1}
          top={1}
          width={54}
          height={12}
          onQueryChange={() => {}}
          onSelect={() => {}}
        />
      ),
      { width: 70, height: 18 },
    );
    await setup.flush();

    setSelectedIndex(1);
    await setup.renderOnce();
    await setup.flush();

    const selectionBg = theme.background.selection.toString();
    const spans = setup.captureSpans().lines.flatMap((line) => line.spans);
    const alphaSpans = spans.filter((span) => span.text.includes(alphaLabel) || span.text.includes(alphaMeta));
    const betaSpans = spans.filter((span) => span.text.includes(betaLabel) || span.text.includes(betaMeta));

    expect(alphaSpans.some((span) => span.bg?.toString() === selectionBg)).toBe(false);
    expect(betaSpans.some((span) => span.bg?.toString() === selectionBg)).toBe(true);
  });
});
