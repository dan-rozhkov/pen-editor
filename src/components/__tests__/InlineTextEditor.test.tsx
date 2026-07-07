import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { InlineTextEditor } from "../InlineTextEditor";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores } from "@/test/fixtures";
import type { TextNode } from "@/types/scene";

function textNode(overrides: Partial<TextNode> = {}): TextNode {
  return {
    id: "t1",
    type: "text",
    name: "Text",
    x: 0,
    y: 0,
    width: 200,
    height: 40,
    text: "one",
    fontSize: 16,
    fontFamily: "Arial",
    textWidthMode: "auto",
    ...overrides,
  } as TextNode;
}

/** Place a collapsed caret `offset` characters into the given line div's own text (ignoring any marker span). */
function placeCaret(lineDiv: HTMLElement, offset: number) {
  const walk = (n: Node): { node: Node; offset: number } | null => {
    if (n.nodeType === Node.TEXT_NODE) return { node: n, offset }
    if (n instanceof HTMLElement && n.hasAttribute("data-text-list-marker")) return null
    for (const child of Array.from(n.childNodes)) {
      const result = walk(child)
      if (result) return result
    }
    return null
  }
  const found = walk(lineDiv) ?? { node: lineDiv, offset: 0 }
  const range = document.createRange()
  range.setStart(found.node, found.offset)
  range.collapse(true)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

describe("<InlineTextEditor />", () => {
  beforeEach(() => {
    resetStores();
    useSceneStore.setState({
      nodesById: { t1: textNode() },
      parentById: { t1: null },
      childrenById: {},
      rootIds: ["t1"],
    });
  });

  afterEach(() => cleanup());

  it("renders one line per paragraph with no markers on plain text", () => {
    const { container } = render(
      <InlineTextEditor node={textNode({ text: "one\ntwo" })} absoluteX={0} absoluteY={0} />,
    );
    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
    expect(editor.children).toHaveLength(2);
    expect(editor.querySelectorAll("[data-text-list-marker]")).toHaveLength(0);
  });

  it("renders a bullet marker span for a list paragraph", () => {
    const { container } = render(
      <InlineTextEditor
        node={textNode({ text: "one\ntwo", paragraphs: [{ listType: "bullet" }, {}] })}
        absoluteX={0}
        absoluteY={0}
      />,
    );
    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
    const markers = editor.querySelectorAll("[data-text-list-marker]");
    expect(markers).toHaveLength(1);
    expect(markers[0].textContent).toBe("•");
    expect(editor.querySelectorAll("[data-text-list-marker]")[0]).toBeTruthy();
  });

  it("Enter inside a bulleted line continues the list onto the new paragraph", () => {
    useSceneStore.setState({
      nodesById: { t1: textNode({ text: "one", paragraphs: [{ listType: "bullet" }] }) },
      parentById: { t1: null },
      childrenById: {},
      rootIds: ["t1"],
    });
    const { container } = render(
      <InlineTextEditor
        node={textNode({ text: "one", paragraphs: [{ listType: "bullet" }] })}
        absoluteX={0}
        absoluteY={0}
      />,
    );
    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
    const firstLine = editor.children[0] as HTMLElement;
    placeCaret(firstLine, 3); // caret at end of "one"

    fireEvent.keyDown(editor, { key: "Enter" });

    const updated = useSceneStore.getState().nodesById.t1 as TextNode;
    expect(updated.text).toBe("one\n");
    expect(updated.paragraphs?.[0]).toEqual({ listType: "bullet" });
    expect(updated.paragraphs?.[1]).toEqual({ listType: "bullet", indentLevel: 0 });
  });

  it("Tab indents the current paragraph", () => {
    useSceneStore.setState({
      nodesById: { t1: textNode({ text: "one", paragraphs: [{ listType: "bullet" }] }) },
      parentById: { t1: null },
      childrenById: {},
      rootIds: ["t1"],
    });
    const { container } = render(
      <InlineTextEditor
        node={textNode({ text: "one", paragraphs: [{ listType: "bullet" }] })}
        absoluteX={0}
        absoluteY={0}
      />,
    );
    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
    const firstLine = editor.children[0] as HTMLElement;
    placeCaret(firstLine, 1);

    fireEvent.keyDown(editor, { key: "Tab" });

    const updated = useSceneStore.getState().nodesById.t1 as TextNode;
    expect(updated.paragraphs?.[0]).toEqual({ listType: "bullet", indentLevel: 1 });
  });

  it("Shift+Tab outdents the current paragraph", () => {
    useSceneStore.setState({
      nodesById: { t1: textNode({ text: "one", paragraphs: [{ listType: "bullet", indentLevel: 2 }] }) },
      parentById: { t1: null },
      childrenById: {},
      rootIds: ["t1"],
    });
    const { container } = render(
      <InlineTextEditor
        node={textNode({ text: "one", paragraphs: [{ listType: "bullet", indentLevel: 2 }] })}
        absoluteX={0}
        absoluteY={0}
      />,
    );
    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
    const firstLine = editor.children[0] as HTMLElement;
    placeCaret(firstLine, 1);

    fireEvent.keyDown(editor, { key: "Tab", shiftKey: true });

    const updated = useSceneStore.getState().nodesById.t1 as TextNode;
    expect(updated.paragraphs?.[0]).toEqual({ listType: "bullet", indentLevel: 1 });
  });

  it("Cmd+Shift+8 toggles a bullet list on the current paragraph", () => {
    useSceneStore.setState({
      nodesById: { t1: textNode({ text: "one" }) },
      parentById: { t1: null },
      childrenById: {},
      rootIds: ["t1"],
    });
    const { container } = render(
      <InlineTextEditor node={textNode({ text: "one" })} absoluteX={0} absoluteY={0} />,
    );
    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
    placeCaret(editor.children[0] as HTMLElement, 1);

    fireEvent.keyDown(editor, { code: "Digit8", metaKey: true, shiftKey: true });

    const updated = useSceneStore.getState().nodesById.t1 as TextNode;
    expect(updated.paragraphs?.[0]).toEqual({ listType: "bullet", indentLevel: 0 });
  });

  it("Cmd+Shift+7 toggles a numbered list on the current paragraph", () => {
    useSceneStore.setState({
      nodesById: { t1: textNode({ text: "one" }) },
      parentById: { t1: null },
      childrenById: {},
      rootIds: ["t1"],
    });
    const { container } = render(
      <InlineTextEditor node={textNode({ text: "one" })} absoluteX={0} absoluteY={0} />,
    );
    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
    placeCaret(editor.children[0] as HTMLElement, 1);

    fireEvent.keyDown(editor, { code: "Digit7", ctrlKey: true, shiftKey: true });

    const updated = useSceneStore.getState().nodesById.t1 as TextNode;
    expect(updated.paragraphs?.[0]).toEqual({ listType: "number", indentLevel: 0 });
  });
});
