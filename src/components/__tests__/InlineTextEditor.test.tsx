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

/** Place a non-collapsed selection from `startOffset` chars into `startLine` to `endOffset` chars into `endLine` (marker spans excluded, same rules as `placeCaret`). */
function placeSelection(startLine: HTMLElement, startOffset: number, endLine: HTMLElement, endOffset: number) {
  const locate = (lineDiv: HTMLElement, offset: number): { node: Node; offset: number } => {
    const walk = (n: Node): { node: Node; offset: number } | null => {
      if (n.nodeType === Node.TEXT_NODE) return { node: n, offset }
      if (n instanceof HTMLElement && n.hasAttribute("data-text-list-marker")) return null
      for (const child of Array.from(n.childNodes)) {
        const result = walk(child)
        if (result) return result
      }
      return null
    }
    return walk(lineDiv) ?? { node: lineDiv, offset: 0 }
  }
  const start = locate(startLine, startOffset)
  const end = locate(endLine, endOffset)
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
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

  it("applies paragraphSpacing as margin-bottom on every line div except the last", () => {
    const { container } = render(
      <InlineTextEditor
        node={textNode({ text: "one\ntwo\nthree", paragraphSpacing: 12 })}
        absoluteX={0}
        absoluteY={0}
      />,
    );
    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
    const lines = Array.from(editor.children) as HTMLElement[];
    expect(lines).toHaveLength(3);
    expect(lines[0].style.marginBottom).toBe("12px");
    expect(lines[1].style.marginBottom).toBe("12px");
    expect(lines[2].style.marginBottom).toBe("");
  });

  it("does not set margin-bottom when paragraphSpacing is 0/unset", () => {
    const { container } = render(
      <InlineTextEditor node={textNode({ text: "one\ntwo" })} absoluteX={0} absoluteY={0} />,
    );
    const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
    const lines = Array.from(editor.children) as HTMLElement[];
    expect(lines[0].style.marginBottom).toBe("");
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

  describe("commitText paragraph resync (finding 1a)", () => {
    it("a native backspace line-merge keeps paragraphs index-aligned with the new (shorter) line count", () => {
      const seed = textNode({
        text: "one\ntwo\nthree",
        paragraphs: [{ listType: "bullet" }, { listType: "bullet" }, {}],
      });
      useSceneStore.setState({
        nodesById: { t1: seed },
        parentById: { t1: null },
        childrenById: {},
        rootIds: ["t1"],
      });
      const { container, unmount } = render(
        <InlineTextEditor node={seed} absoluteX={0} absoluteY={0} />,
      );
      const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;

      // No onPaste/backspace intercept exists in InlineTextEditor, so the
      // browser applies this natively — simulate the resulting DOM directly:
      // pressing Backspace at the start of "two" merges "one" + "two".
      editor.innerHTML = "";
      const line0 = document.createElement("div");
      line0.textContent = "onetwo";
      const line1 = document.createElement("div");
      line1.textContent = "three";
      editor.appendChild(line0);
      editor.appendChild(line1);
      fireEvent.input(editor);

      unmount(); // flushes the pending commit (see flushPendingText in the unmount cleanup)

      const updated = useSceneStore.getState().nodesById.t1 as TextNode;
      expect(updated.text).toBe("onetwo\nthree");
      // Without the fix this would still be the stale 3-entry array.
      expect(updated.paragraphs).toHaveLength(2);
    });

    it("a simulated multi-line paste (line count increases) pads new paragraphs with plain defaults", () => {
      const seed = textNode({ text: "one", paragraphs: [{ listType: "bullet" }] });
      useSceneStore.setState({
        nodesById: { t1: seed },
        parentById: { t1: null },
        childrenById: {},
        rootIds: ["t1"],
      });
      const { container, unmount } = render(
        <InlineTextEditor node={seed} absoluteX={0} absoluteY={0} />,
      );
      const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;

      editor.innerHTML = "";
      for (const t of ["one", "pasted-a", "pasted-b"]) {
        const div = document.createElement("div");
        div.textContent = t;
        editor.appendChild(div);
      }
      fireEvent.input(editor);

      unmount();

      const updated = useSceneStore.getState().nodesById.t1 as TextNode;
      expect(updated.text).toBe("one\npasted-a\npasted-b");
      expect(updated.paragraphs).toEqual([{ listType: "bullet" }, {}, {}]);
    });
  });

  describe("Enter with a non-collapsed selection (finding 2)", () => {
    it("deletes a multi-character single-line selection before splitting", () => {
      useSceneStore.setState({
        nodesById: { t1: textNode({ text: "aabbcc" }) },
        parentById: { t1: null },
        childrenById: {},
        rootIds: ["t1"],
      });
      const { container } = render(
        <InlineTextEditor node={textNode({ text: "aabbcc" })} absoluteX={0} absoluteY={0} />,
      );
      const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
      const line = editor.children[0] as HTMLElement;
      placeSelection(line, 2, line, 4); // select "bb"

      fireEvent.keyDown(editor, { key: "Enter" });

      const updated = useSceneStore.getState().nodesById.t1 as TextNode;
      expect(updated.text).toBe("aa\ncc");
    });

    it("deletes a selection spanning two lines before splitting", () => {
      useSceneStore.setState({
        nodesById: { t1: textNode({ text: "hello\nworld" }) },
        parentById: { t1: null },
        childrenById: {},
        rootIds: ["t1"],
      });
      const { container } = render(
        <InlineTextEditor node={textNode({ text: "hello\nworld" })} absoluteX={0} absoluteY={0} />,
      );
      const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
      const line0 = editor.children[0] as HTMLElement;
      const line1 = editor.children[1] as HTMLElement;
      placeSelection(line0, 3, line1, 2); // select "lo\nwo"

      fireEvent.keyDown(editor, { key: "Enter" });

      const updated = useSceneStore.getState().nodesById.t1 as TextNode;
      expect(updated.text).toBe("hel\nrld");
    });

    it("a collapsed selection (plain caret) still splits normally", () => {
      useSceneStore.setState({
        nodesById: { t1: textNode({ text: "aabbcc" }) },
        parentById: { t1: null },
        childrenById: {},
        rootIds: ["t1"],
      });
      const { container } = render(
        <InlineTextEditor node={textNode({ text: "aabbcc" })} absoluteX={0} absoluteY={0} />,
      );
      const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
      placeCaret(editor.children[0] as HTMLElement, 2);

      fireEvent.keyDown(editor, { key: "Enter" });

      const updated = useSceneStore.getState().nodesById.t1 as TextNode;
      expect(updated.text).toBe("aa\nbbcc");
    });
  });

  describe("Tab on plain text (finding 3)", () => {
    it("does not intercept Tab, and does not persist an indentLevel, on a listType: 'none' paragraph", () => {
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

      const notCanceled = fireEvent.keyDown(editor, { key: "Tab" });

      expect(notCanceled).toBe(true); // preventDefault was NOT called
      const updated = useSceneStore.getState().nodesById.t1 as TextNode;
      expect(updated.paragraphs).toBeUndefined();
    });

    it("still intercepts Tab (and Shift+Tab) when the paragraph is part of a list", () => {
      const seed = textNode({ text: "one", paragraphs: [{ listType: "bullet" }] });
      useSceneStore.setState({
        nodesById: { t1: seed },
        parentById: { t1: null },
        childrenById: {},
        rootIds: ["t1"],
      });
      const { container } = render(<InlineTextEditor node={seed} absoluteX={0} absoluteY={0} />);
      const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
      placeCaret(editor.children[0] as HTMLElement, 1);

      const notCanceled = fireEvent.keyDown(editor, { key: "Tab" });

      expect(notCanceled).toBe(false); // preventDefault WAS called
      const updated = useSceneStore.getState().nodesById.t1 as TextNode;
      expect(updated.paragraphs?.[0]).toEqual({ listType: "bullet", indentLevel: 1 });
    });
  });

  describe("external paragraphs-only sync (finding 7e)", () => {
    it("rebuilds markers when only node.paragraphs changes while not focused", () => {
      const initial = textNode({ text: "one" });
      useSceneStore.setState({
        nodesById: { t1: initial },
        parentById: { t1: null },
        childrenById: {},
        rootIds: ["t1"],
      });
      const { container, rerender } = render(
        <InlineTextEditor node={initial} absoluteX={0} absoluteY={0} />,
      );
      const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
      expect(editor.querySelectorAll("[data-text-list-marker]")).toHaveLength(0);

      editor.blur();
      rerender(
        <InlineTextEditor
          node={textNode({ text: "one", paragraphs: [{ listType: "bullet" }] })}
          absoluteX={0}
          absoluteY={0}
        />,
      );

      expect(editor.querySelectorAll("[data-text-list-marker]")).toHaveLength(1);
    });
  });

  describe("text links", () => {
    it("applies the default link color and underline when linked with no explicit fill", () => {
      const { container } = render(
        <InlineTextEditor
          node={textNode({ link: { url: "https://example.com" } })}
          absoluteX={0}
          absoluteY={0}
        />,
      );
      const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
      expect(editor.style.color).toBe("#0d99ff");
      expect(editor.style.textDecoration).toContain("underline");
    });

    it("respects an explicit fill over the default link color", () => {
      const { container } = render(
        <InlineTextEditor
          node={textNode({ link: { url: "https://example.com" }, fill: "#ff0000" })}
          absoluteX={0}
          absoluteY={0}
        />,
      );
      const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
      expect(editor.style.color).toBe("#ff0000");
      expect(editor.style.textDecoration).toContain("underline");
    });

    it("does not force an underline/link color when unlinked", () => {
      const { container } = render(
        <InlineTextEditor node={textNode()} absoluteX={0} absoluteY={0} />,
      );
      const editor = container.querySelector('[contenteditable="true"]') as HTMLElement;
      expect(editor.style.textDecoration).toBeFalsy();
    });
  });
});
