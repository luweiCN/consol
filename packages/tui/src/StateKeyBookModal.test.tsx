/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test";
import { createTranslator } from "@consol/i18n";
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
  "tui.state.keyBook.listHint": "↑/↓ select | → actions | Esc close",
  "tui.state.keyBook.currentGroup": "Current key",
  "tui.state.keyBook.listGroup": "Key Book",
  "tui.state.keyBook.search": "search",
  "tui.state.keyBook.searchHint": "type search | Backspace delete | Enter done | Esc cancel",
  "tui.state.keyBook.actions": "Key actions",
  "tui.state.keyBook.title": "Key Book",
  "tui.state.keyBook.unlabeled": "unlabeled",
  "tui.picker.actionHint": "↑/↓ select action | Enter confirm | ←/Esc return",
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
          onFieldFocus={() => {}}
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
          onEntrySelect={() => {}}
          onActionSelect={() => {}}
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

  test("renders a compact Chinese key list hint with the shared action key", async () => {
    const zh = createTranslator("zh-CN");
    const setup = await testRender(
      () => (
        <StateKeyBookListModal
          rect={{ left: 1, top: 1, width: 56, height: 18 }}
          translate={zh}
          keyType="address"
          entries={[{ type: "address", value: "0x000000000000000000000000000000000000c0fe", label: "owner" }]}
          selectedIndex={0}
          query=""
          actions={[]}
          actionMenuIndex={null}
          onQueryChange={() => {}}
          onEntrySelect={() => {}}
          onActionSelect={() => {}}
        />
      ),
      { width: 80, height: 26 },
    );
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("→ 操作");
    expect(frame).not.toContain("Enter 操作");
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
          onEntrySelect={() => {}}
          onActionSelect={() => {}}
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

  test("mouse selects existing key and action rows without adding a close button", async () => {
    const selected: number[] = [];
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
          onEntrySelect={(index) => selected.push(index)}
          onActionSelect={() => {}}
        />
      ),
      { width: 90, height: 26, useMouse: true },
    );
    await setup.flush();

    const clickLabel = async (label: string) => {
      const lines = setup.captureCharFrame().split("\n");
      const row = lines.findIndex((line) => line.includes(label));
      const column = lines[row]?.indexOf(label) ?? -1;
      if (row < 0 || column < 0) throw new Error(`missing ${label}`);
      await setup.mockMouse.click(column + 1, row);
      await setup.renderOnce();
    };
    await clickLabel("owner");
    expect(selected).toEqual([0]);
    expect(setup.captureCharFrame()).not.toContain("[ Close ]");

    const actions: number[] = [];
    const actionSetup = await testRender(
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
          ]}
          actionMenuIndex={0}
          onQueryChange={() => {}}
          onEntrySelect={() => {}}
          onActionSelect={(index) => actions.push(index)}
        />
      ),
      { width: 90, height: 26, useMouse: true },
    );
    await actionSetup.flush();
    const actionLines = actionSetup.captureCharFrame().split("\n");
    const actionRow = actionLines.findIndex((line) => line.includes("Delete key"));
    const actionColumn = actionLines[actionRow]?.indexOf("Delete key") ?? -1;
    await actionSetup.mockMouse.click(actionColumn + 1, actionRow);
    await actionSetup.renderOnce();
    expect(actions).toEqual([1]);
  });
});
