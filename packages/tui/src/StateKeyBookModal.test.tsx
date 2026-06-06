/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { StateKeyBookListModal, StateKeyBookModal } from "./StateKeyBookModal";
import type { MessageKey } from "@consol/i18n";

const messages: Partial<Record<MessageKey, string>> = {
  "tui.state.detail.type": "type",
  "tui.state.keyBook.add": "Add key",
  "tui.state.keyBook.hint": "Tab field | Enter save | Esc cancel",
  "tui.state.keyBook.key": "key",
  "tui.state.keyBook.keyPlaceholder": "address, number, or bytes value",
  "tui.state.keyBook.label": "label",
  "tui.state.keyBook.labelPlaceholder": "optional note",
  "tui.state.keyBook.listHint": "type search | ↑/↓ select | Enter actions | Esc close | → actions",
  "tui.state.keyBook.currentGroup": "Current key",
  "tui.state.keyBook.listGroup": "Key Book",
  "tui.state.keyBook.search": "search",
  "tui.state.keyBook.searchHint": "type search | Backspace delete | Enter done | Esc cancel",
  "tui.state.keyBook.actions": "Key actions",
  "tui.state.keyBook.title": "Key Book",
  "tui.state.keyBook.unlabeled": "unlabeled",
  "tui.picker.actionHint": "↑/↓ select action | Enter confirm | ← return",
};

const translate = (key: MessageKey) => messages[key] ?? key;

describe("StateKeyBookModal", () => {
  test("submits from the focused key input", async () => {
    let submitted = 0;
    const setup = await testRender(
      () => (
        <StateKeyBookModal
          rect={{ left: 1, top: 1, width: 60, height: 14 }}
          translate={translate}
          mode="add"
          keyType="address"
          keyText=""
          labelText=""
          activeField="key"
          onKeyChange={() => {}}
          onLabelChange={() => {}}
          onSubmit={() => {
            submitted += 1;
          }}
        />
      ),
      { width: 80, height: 24 },
    );
    await setup.flush();

    setup.mockInput.pressEnter();
    await setup.renderOnce();

    expect(submitted).toBe(1);
  });

  test("renders the key list with the shared selector chrome", async () => {
    const setup = await testRender(
      () => (
        <StateKeyBookListModal
          rect={{ left: 1, top: 1, width: 68, height: 18 }}
          translate={translate}
          keyType="address"
          entries={[{ type: "address", value: "0x000000000000000000000000000000000000c0fe", label: "owner" }]}
          selectedIndex={0}
          query=""
          actions={[]}
          actionMenuIndex={null}
          onQueryChange={() => {}}
        />
      ),
      { width: 90, height: 26 },
    );
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Key Book (address)");
    expect(frame).toContain("owner");
    expect(frame).toContain("→ actions");
  });

  test("renders grouped picker actions", async () => {
    const setup = await testRender(
      () => (
        <StateKeyBookListModal
          rect={{ left: 1, top: 1, width: 68, height: 18 }}
          translate={translate}
          keyType="address"
          entries={[{ type: "address", value: "0x000000000000000000000000000000000000c0fe", label: "owner" }]}
          selectedIndex={0}
          query=""
          actions={[
            { id: "edit", label: "Edit label", group: "Current key" },
            { id: "delete", label: "Delete key", group: "Current key", danger: true },
            { id: "add", label: "Add key", group: "Key Book" },
          ]}
          actionMenuIndex={2}
          onQueryChange={() => {}}
        />
      ),
      { width: 90, height: 26 },
    );
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Current key");
    expect(frame).toContain("Key Book");
    expect(frame).toContain("> Add key");
  });
});
