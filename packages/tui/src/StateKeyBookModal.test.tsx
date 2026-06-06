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
  "tui.state.keyBook.listHint": "↑/↓ | / search | a add | x delete | Enter | Esc",
  "tui.state.keyBook.search": "search",
  "tui.state.keyBook.searchHint": "type search | Backspace delete | Enter done | Esc cancel",
  "tui.state.keyBook.title": "Key Book",
  "tui.state.keyBook.unlabeled": "unlabeled",
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
          searchActive={false}
          actionMenuIndex={null}
        />
      ),
      { width: 90, height: 26 },
    );
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("Key Book (address)");
    expect(frame).toContain("owner");
    expect(frame).toContain("a add");
  });
});
