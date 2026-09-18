import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { EmbedLayer } from "../EmbedLayer";
import { useSceneStore } from "@/store/sceneStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";
import { buildElementPath } from "@/lib/embedElementPicker";

function seedEmbed(
  htmlContent = "<div><button id='cta'>Buy now</button><p><span>Nested</span><span>Text</span></p></div>",
): void {
  useSceneStore.setState({
    nodesById: {
      e1: {
        id: "e1",
        type: "embed",
        name: "Code",
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        htmlContent,
      } as unknown as FlatSceneNode,
    },
    parentById: { e1: null },
    childrenById: {},
    rootIds: ["e1"],
    _cachedTree: null,
  });
}

function dblclick(el: Element): void {
  el.dispatchEvent(
    new MouseEvent("dblclick", { bubbles: true, composed: true, cancelable: true }),
  );
}

describe("<EmbedLayer /> element picker — dblclick to edit text", () => {
  beforeEach(() => {
    resetStores();
    seedEmbed();
  });
  afterEach(() => cleanup());

  it("hovering an embed while picking (but not yet inside an element) shows an ordinary arrow, not crosshair", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    expect(host.style.cursor).toBe("default");
  });

  it("dblclick on a text-leaf element enters edit mode: contenteditable, focus, store state, and selection", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;

    act(() => dblclick(button));

    expect(button.getAttribute("contenteditable")).toBe("plaintext-only");
    expect(document.activeElement === host || host.shadowRoot!.activeElement === button).toBe(
      true,
    );
    const state = useEmbedPickerStore.getState();
    expect(state.editingEmbedId).toBe("e1");
    expect(state.editingPath).toBeTruthy();
    expect(state.selection?.tagName).toBe("button");
  });

  it("dblclick on a non-text-leaf container does nothing — no contenteditable, no editing state", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const p = host.shadowRoot!.querySelector("p")!; // holds two <span> children with the real text

    act(() => dblclick(p));

    expect(p.hasAttribute("contenteditable")).toBe(false);
    expect(useEmbedPickerStore.getState().editingEmbedId).toBeNull();
  });

  it("does not enter edit mode when the canvas is not editable", () => {
    act(() => useEditorModeStore.setState({ mode: "view" }));
    try {
      const { container } = render(<EmbedLayer />);
      act(() => useEmbedPickerStore.getState().startPicking("e1"));

      const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
      const button = host.shadowRoot!.querySelector("button")!;

      act(() => dblclick(button));

      expect(button.hasAttribute("contenteditable")).toBe(false);
      expect(useEmbedPickerStore.getState().editingEmbedId).toBeNull();
    } finally {
      // resetStores() doesn't touch editorModeStore — restore it explicitly
      // so this test's "view" mode doesn't leak into every test after it.
      act(() => useEditorModeStore.setState({ mode: "edit" }));
    }
  });

  it("Enter commits the edited text: noteSelectionEdit lands before updateNode, and contenteditable never reaches htmlContent", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;

    const calls: string[] = [];
    const realNoteSelectionEdit = useEmbedPickerStore.getState().noteSelectionEdit;
    const realUpdateNode = useSceneStore.getState().updateNode;
    const noteSpy = vi
      .spyOn(useEmbedPickerStore.getState(), "noteSelectionEdit")
      .mockImplementation((...args: Parameters<typeof realNoteSelectionEdit>) => {
        calls.push("noteSelectionEdit");
        return realNoteSelectionEdit(...args);
      });
    const updateSpy = vi
      .spyOn(useSceneStore.getState(), "updateNode")
      .mockImplementation((...args: Parameters<typeof realUpdateNode>) => {
        calls.push("updateNode");
        return realUpdateNode(...args);
      });

    act(() => dblclick(button));
    act(() => {
      button.textContent = "Buy later";
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });

    expect(noteSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["noteSelectionEdit", "updateNode"]);
    expect(button.hasAttribute("contenteditable")).toBe(false);
    expect(useEmbedPickerStore.getState().editingEmbedId).toBeNull();

    const [, patch] = updateSpy.mock.calls[0] as [string, { htmlContent: string }];
    expect(patch.htmlContent).toContain("Buy later");
    expect(patch.htmlContent).not.toContain("contenteditable");

    noteSpy.mockRestore();
    updateSpy.mockRestore();
  });

  it("Escape reverts the text and writes nothing to the scene", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const updateSpy = vi.spyOn(useSceneStore.getState(), "updateNode");
    updateSpy.mockClear();

    act(() => dblclick(button));
    act(() => {
      button.textContent = "Something else entirely";
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(button.textContent).toBe("Buy now");
    expect(button.hasAttribute("contenteditable")).toBe(false);
    expect(useEmbedPickerStore.getState().editingEmbedId).toBeNull();

    updateSpy.mockRestore();
  });

  it("blur commits the edit, same as Enter", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const updateSpy = vi.spyOn(useSceneStore.getState(), "updateNode");
    updateSpy.mockClear();

    act(() => dblclick(button));
    act(() => {
      button.textContent = "Buy soon";
      button.dispatchEvent(new FocusEvent("blur"));
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(useEmbedPickerStore.getState().editingEmbedId).toBeNull();

    updateSpy.mockRestore();
  });

  it("commit is a no-op write-wise when the text didn't actually change", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const updateSpy = vi.spyOn(useSceneStore.getState(), "updateNode");
    updateSpy.mockClear();

    act(() => dblclick(button));
    act(() => {
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(button.hasAttribute("contenteditable")).toBe(false);

    updateSpy.mockRestore();
  });

  it("abandons the commit (writes nothing) when htmlContent changed elsewhere mid-edit", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const updateSpy = vi.spyOn(useSceneStore.getState(), "updateNode");
    updateSpy.mockClear();

    act(() => dblclick(button));

    // Simulate a concurrent edit_embed_html/batch_design mutation landing
    // while the user is still typing.
    act(() => {
      useSceneStore.getState().updateNode("e1", {
        htmlContent: "<div><button id='cta'>Different now</button></div>",
      });
    });
    updateSpy.mockClear();

    act(() => {
      button.textContent = "Buy later";
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });

    expect(updateSpy).not.toHaveBeenCalled();

    updateSpy.mockRestore();
  });

  it("pointerdown on a different element inside the embed commits the in-flight edit first", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const otherSpan = host.shadowRoot!.querySelectorAll("span")[0];
    const updateSpy = vi.spyOn(useSceneStore.getState(), "updateNode");
    updateSpy.mockClear();

    act(() => dblclick(button));
    act(() => {
      button.textContent = "Buy today";
      otherSpan.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          composed: true,
          cancelable: true,
          button: 0,
          isPrimary: true,
        }),
      );
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(useEmbedPickerStore.getState().editingEmbedId).toBeNull();

    updateSpy.mockRestore();
  });

  it("leaving picking mode mid-edit (isPicking flips off) commits rather than discards the typed text", () => {
    // This is the picking effect's OWN teardown path — `stopPicking()` flips
    // `isPicking` false, which tears down and re-runs the effect while the
    // embed host itself stays mounted and connected. Distinct from a full
    // component unmount (see below): there, React already detaches the DOM
    // before any cleanup runs, so `e.el.isConnected` is false and the
    // staleness guard correctly abandons the write instead — the same
    // guard this test exercises the opposite (successful) side of.
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const updateSpy = vi.spyOn(useSceneStore.getState(), "updateNode");
    updateSpy.mockClear();

    act(() => dblclick(button));
    act(() => {
      button.textContent = "Buy while stock lasts";
    });

    act(() => useEmbedPickerStore.getState().stopPicking());

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [, patch] = updateSpy.mock.calls[0] as [string, { htmlContent: string }];
    expect(patch.htmlContent).toContain("Buy while stock lasts");

    updateSpy.mockRestore();
  });

  it("a full component unmount mid-edit does not throw and does not write — the element is already disconnected by the time cleanup runs", () => {
    const { container, unmount } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const updateSpy = vi.spyOn(useSceneStore.getState(), "updateNode");
    updateSpy.mockClear();

    act(() => dblclick(button));
    act(() => {
      button.textContent = "Buy while stock lasts";
    });

    expect(() => act(() => unmount())).not.toThrow();
    expect(updateSpy).not.toHaveBeenCalled();

    updateSpy.mockRestore();
  });

  it("does not advertise contenteditable in the selection snapshot taken on entry (Finding 7)", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;

    act(() => dblclick(button));

    // The element IS contenteditable live (see the first test above) — but
    // the snapshot handed to the properties panel / agent must describe it
    // as it exists in `htmlContent`, which never has this attribute.
    const selection = useEmbedPickerStore.getState().selection;
    expect(selection?.outerHtml).not.toContain("contenteditable");
  });
});

describe("<EmbedLayer /> element picker — dblclick to edit text preserves structural children (Finding 2)", () => {
  const ICON_HTML =
    "<div><button id='cta'><i class=\"ph ph-plus\"></i>Add</button></div>";

  beforeEach(() => {
    resetStores();
    seedEmbed(ICON_HTML);
  });
  afterEach(() => cleanup());

  it("committing a text edit on an icon-plus-text button leaves the icon child intact", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const updateSpy = vi.spyOn(useSceneStore.getState(), "updateNode");
    updateSpy.mockClear();

    act(() => dblclick(button));
    act(() => {
      // Simulate `plaintext-only` typing: only the trailing text node
      // changes — a real contenteditable never lets the user delete the
      // `<i>` sibling by typing, so the test edit must not either.
      const textNode = Array.from(button.childNodes).find(
        (n) => n.nodeType === Node.TEXT_NODE,
      )!;
      textNode.textContent = "Add now";
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [, patch] = updateSpy.mock.calls[0] as [string, { htmlContent: string }];
    expect(patch.htmlContent).toContain('<i class="ph ph-plus">');
    expect(patch.htmlContent).toContain("Add now");
    expect(patch.htmlContent).not.toContain("contenteditable");

    updateSpy.mockRestore();
  });

  it("Escape reverts an icon-plus-text button to its exact original markup, icon included", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const originalInnerHtml = button.innerHTML;

    act(() => dblclick(button));
    act(() => {
      const textNode = Array.from(button.childNodes).find(
        (n) => n.nodeType === Node.TEXT_NODE,
      )!;
      textNode.textContent = "Something else";
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

    expect(button.innerHTML).toBe(originalInnerHtml);
    expect(button.querySelector("i.ph-plus")).not.toBeNull();
    expect(button.hasAttribute("contenteditable")).toBe(false);
  });
});

describe("<EmbedLayer /> element picker — text selection is cleared on exit, not left highlighted", () => {
  // happy-dom has no real `Selection`/`ShadowRoot.getSelection` (see
  // `getShadowSelection`'s own comment), and this embed host's shadow root
  // doesn't implement `getSelection` at all here, so `getShadowSelection`
  // falls through to `document.getSelection()` — stub THAT to drive the
  // "is the caller's selection actually inside `el`" branch deterministically.
  beforeEach(() => {
    resetStores();
    seedEmbed();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  function stubSelectionInside(el: Element) {
    const removeAllRanges = vi.fn();
    vi.spyOn(document, "getSelection").mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => ({ commonAncestorContainer: el }),
      removeAllRanges,
      addRange: vi.fn(),
    } as unknown as Selection);
    return removeAllRanges;
  }

  function stubSelectionOutside() {
    const removeAllRanges = vi.fn();
    vi.spyOn(document, "getSelection").mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => ({ commonAncestorContainer: document.body }),
      removeAllRanges,
      addRange: vi.fn(),
    } as unknown as Selection);
    return removeAllRanges;
  }

  // Simulates the real WebKit/Firefox failure mode: `ShadowRoot.getSelection`
  // isn't implemented there, so `document.getSelection()` is used instead —
  // and the browser RETARGETS nodes crossing the shadow boundary for that
  // call, so `commonAncestorContainer` comes back as `retargetedTo` (the
  // shadow host, or an ancestor of it), never the actual editable element
  // inside the shadow tree. `el.contains(retargetedTo)` is therefore always
  // false here; `intersectsNode` is the only way `clearTextSelectionIn` can
  // still recognize the selection as "ours".
  function stubRetargetedSelection(retargetedTo: Element, intersects: boolean) {
    const removeAllRanges = vi.fn();
    const intersectsNode = vi.fn(() => intersects);
    vi.spyOn(document, "getSelection").mockReturnValue({
      rangeCount: 1,
      getRangeAt: () => ({ commonAncestorContainer: retargetedTo, intersectsNode }),
      removeAllRanges,
      addRange: vi.fn(),
    } as unknown as Selection);
    return { removeAllRanges, intersectsNode };
  }

  it("Escape clears a selection left inside the edited element", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;

    act(() => dblclick(button));
    const removeAllRanges = stubSelectionInside(button);

    act(() => {
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

    expect(removeAllRanges).toHaveBeenCalled();
  });

  it("Enter (commit) clears a selection left inside the edited element", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;

    act(() => dblclick(button));
    const removeAllRanges = stubSelectionInside(button);

    act(() => {
      button.textContent = "Buy later";
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });

    expect(removeAllRanges).toHaveBeenCalled();
  });

  it("does not touch a selection that lives outside the edited element", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;

    act(() => dblclick(button));
    const removeAllRanges = stubSelectionOutside();

    act(() => {
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

    expect(removeAllRanges).not.toHaveBeenCalled();
  });

  it("Escape clears a retargeted (WebKit-style) selection that intersects the embed host", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;

    act(() => dblclick(button));
    // happy-dom's shadow root has no own `getSelection`, matching WebKit/
    // Firefox — `document.getSelection()` retargets to `host` itself rather
    // than `button`, so only the `intersectsNode(host)` fallback path can
    // recognize this selection as belonging to the edited element.
    const { removeAllRanges, intersectsNode } = stubRetargetedSelection(host, true);

    act(() => {
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

    expect(removeAllRanges).toHaveBeenCalled();
    expect(intersectsNode).toHaveBeenCalledWith(host);
  });

  it("does not clear a retargeted selection that does not intersect the embed host", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;

    act(() => dblclick(button));
    const { removeAllRanges } = stubRetargetedSelection(host, false);

    act(() => {
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

    expect(removeAllRanges).not.toHaveBeenCalled();
  });
});

describe("<EmbedLayer /> element picker — native caret cursor during inline text edit", () => {
  beforeEach(() => {
    resetStores();
    seedEmbed();
  });
  afterEach(() => cleanup());

  it("does not force the arrow cursor on the host while an element is being edited", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;

    // Before entering edit mode, picking mode forces the ordinary arrow so
    // hovering doesn't look draggable.
    expect(host.style.cursor).toBe("default");

    act(() => dblclick(button));

    // Once inside edit mode, forcing any explicit cursor (not "auto") on the
    // host would inherit into the shadow content and paint an arrow over the
    // contenteditable text instead of the native I-beam caret. So nothing
    // should be forced here.
    expect(host.style.cursor).not.toBe("default");
  });
});

describe("<EmbedLayer /> element picker — dblclick on a second element right after committing the first (Finding 5)", () => {
  beforeEach(() => {
    resetStores();
    seedEmbed("<div><button id='a'>Buy now</button><button id='b'>Continue</button></div>");
  });
  afterEach(() => cleanup());

  it("enters edit mode on the second element and its commit lands, even though the first commit remounted the shadow DOM", async () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const buttonA = host.shadowRoot!.querySelector("#a")!;

    act(() => dblclick(buttonA));
    act(() => {
      buttonA.textContent = "Buy later";
    });

    // The SECOND dblclick both commits A's edit (writing a new htmlContent,
    // which remounts the whole shadow tree on the next passive-effect pass)
    // and asks to enter edit mode on B — resolved against the DOM as it
    // exists at dispatch time, before that remount has happened.
    const buttonBBeforeRemount = host.shadowRoot!.querySelector("#b")!;
    act(() => dblclick(buttonBBeforeRemount));

    // Flush the deferred re-entry (queued via requestAnimationFrame so the
    // remount effect gets to run first — see `handleDblClick`'s comment).
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const state = useEmbedPickerStore.getState();
    expect(state.editingEmbedId).toBe("e1");
    expect(state.selection?.tagName).toBe("button");

    // B, in the FRESH shadow root, must be the live contenteditable target
    // — not the old, now-detached `buttonBBeforeRemount` reference.
    const freshHost = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const freshButtonB = freshHost.shadowRoot!.querySelector("#b")!;
    expect(freshButtonB.getAttribute("contenteditable")).toBe("plaintext-only");
    expect(buttonBBeforeRemount.isConnected).toBe(false);

    const updateSpy = vi.spyOn(useSceneStore.getState(), "updateNode");
    updateSpy.mockClear();

    act(() => {
      freshButtonB.textContent = "Continue now";
      freshButtonB.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [, patch] = updateSpy.mock.calls[0] as [string, { htmlContent: string }];
    expect(patch.htmlContent).toContain("Continue now");
    expect(patch.htmlContent).toContain("Buy later");

    updateSpy.mockRestore();
  });
});

describe("<EmbedLayer /> element picker — committing a text edit never leaks mount-time-only attributes (Finding 3)", () => {
  // A text leaf that carries an <img> child, exactly the
  // Phosphor-icon-inside-a-button idiom `isTextLeaf`'s SKIP_TAGS allows —
  // `<img>` never had a `loading`/`decoding` attribute in the AUTHOR's own
  // markup, so mounting must be the only thing that ever puts one there.
  beforeEach(() => {
    resetStores();
    seedEmbed('<div><span id="txt"><img src="a.png">Hello</span></div>');
  });
  afterEach(() => cleanup());

  it("does not write forced eager-loading attributes into htmlContent on an unrelated text commit", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const span = host.shadowRoot!.querySelector("#txt")!;
    // Mounting already forced these onto the LIVE img — that's the whole
    // point of `forceEagerImageLoading`, and it must stay true for display.
    const liveImg = span.querySelector("img")!;
    expect(liveImg.getAttribute("loading")).toBe("eager");

    const updateSpy = vi.spyOn(useSceneStore.getState(), "updateNode");
    updateSpy.mockClear();

    act(() => {
      span.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, composed: true, cancelable: true }),
      );
    });
    act(() => {
      const textNode = Array.from(span.childNodes).find((n) => n.nodeType === Node.TEXT_NODE)!;
      textNode.textContent = "Hello there";
      span.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [, patch] = updateSpy.mock.calls[0] as [string, { htmlContent: string }];
    expect(patch.htmlContent).toContain("Hello there");
    expect(patch.htmlContent).toContain("<img");
    expect(patch.htmlContent).not.toContain("loading=");
    expect(patch.htmlContent).not.toContain("decoding=");
    expect(patch.htmlContent).not.toContain("data-pen-embed-eager");
    expect(patch.htmlContent).not.toContain("data-pen-embed-decoding");

    // The LIVE img must still be eager afterwards — this fix strips the
    // attribute off a CLONE only, never the element that's actually on
    // screen.
    const freshHost = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const freshImg = freshHost.shadowRoot!.querySelector("img")!;
    expect(freshImg.getAttribute("loading")).toBe("eager");

    updateSpy.mockRestore();
  });
});

describe("<EmbedLayer /> element picker — paste during inline text edit never introduces markup (Finding 4)", () => {
  beforeEach(() => {
    resetStores();
    seedEmbed();
  });
  afterEach(() => cleanup());

  function pasteEvent(plainText: string, html: string): ClipboardEvent {
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (type: string) => (type === "text/plain" ? plainText : html) },
    });
    return event;
  }

  it("inserts clipboard text/plain only — a formatted HTML fragment on the clipboard never reaches htmlContent", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const button = host.shadowRoot!.querySelector("button")!;
    const updateSpy = vi.spyOn(useSceneStore.getState(), "updateNode");
    updateSpy.mockClear();

    act(() => dblclick(button));

    const event = pasteEvent("PASTED", "<b>PASTED</b><script>evil()</script>");
    act(() => {
      button.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);

    act(() => {
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [, patch] = updateSpy.mock.calls[0] as [string, { htmlContent: string }];
    expect(patch.htmlContent).toContain("PASTED");
    expect(patch.htmlContent).not.toContain("<b>");
    expect(patch.htmlContent).not.toContain("<script>");

    updateSpy.mockRestore();
  });
});

describe("<EmbedLayer /> element picker — keyboard navigation entry point (requestElementEdit)", () => {
  beforeEach(() => {
    resetStores();
    seedEmbed();
  });
  afterEach(() => cleanup());

  it("starts the same inline edit as dblclick when the path resolves to a text leaf", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const root = host.shadowRoot!;
    const button = root.querySelector("button")!;
    const path = buildElementPath(button, root);

    let started = false;
    act(() => {
      started = useEmbedPickerStore.getState().requestElementEdit!(path);
    });

    expect(started).toBe(true);
    expect(button.getAttribute("contenteditable")).toBe("plaintext-only");
    const state = useEmbedPickerStore.getState();
    expect(state.editingEmbedId).toBe("e1");
    expect(state.editingPath).toBe(path);
  });

  it("returns false and does not enter edit mode for a non-text-leaf path", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const root = host.shadowRoot!;
    const p = root.querySelector("p")!; // holds two <span> children — not a text leaf
    const path = buildElementPath(p, root);

    let started = true;
    act(() => {
      started = useEmbedPickerStore.getState().requestElementEdit!(path);
    });

    expect(started).toBe(false);
    expect(p.getAttribute("contenteditable")).toBeNull();
    expect(useEmbedPickerStore.getState().editingEmbedId).toBeNull();
  });

  it("returns false for a path that no longer resolves to any live element", () => {
    render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    let started = true;
    act(() => {
      started = useEmbedPickerStore.getState().requestElementEdit!("nonexistent > path");
    });

    expect(started).toBe(false);
    expect(useEmbedPickerStore.getState().editingEmbedId).toBeNull();
  });

  it("commits an in-flight edit before starting a new one on a different element", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const root = host.shadowRoot!;
    const button = root.querySelector("button")!;
    const spans = root.querySelectorAll("span");
    const buttonPath = buildElementPath(button, root);
    const spanPath = buildElementPath(spans[0], root);

    act(() => {
      useEmbedPickerStore.getState().requestElementEdit!(buttonPath);
    });
    act(() => {
      button.textContent = "Buy soon";
    });
    const updateSpy = vi.spyOn(useSceneStore.getState(), "updateNode");
    updateSpy.mockClear();

    // A second `requestElementEdit` call while the first edit is still open
    // (never committed by Enter/blur/Escape) must commit it first — same
    // invariant `handlePointerDown`/`handleDblClick` enforce with their own
    // `if (edit) commitElementEdit()` before starting a new one.
    let started = false;
    act(() => {
      started = useEmbedPickerStore.getState().requestElementEdit!(spanPath);
    });

    expect(started).toBe(true);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [, patch] = updateSpy.mock.calls[0] as [string, { htmlContent: string }];
    expect(patch.htmlContent).toContain("Buy soon");
    // The button is no longer contenteditable — its edit session was closed
    // out, not left dangling underneath the new one.
    expect(button.hasAttribute("contenteditable")).toBe(false);

    updateSpy.mockRestore();
  });

  it("does not start an edit in a read-only mode, even with a resolvable text-leaf path", () => {
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const root = host.shadowRoot!;
    const button = root.querySelector("button")!;
    const path = buildElementPath(button, root);

    act(() => useEditorModeStore.setState({ mode: "view" }));
    let started = true;
    try {
      act(() => {
        started = useEmbedPickerStore.getState().requestElementEdit!(path);
      });

      expect(started).toBe(false);
      expect(button.hasAttribute("contenteditable")).toBe(false);
      expect(useEmbedPickerStore.getState().editingEmbedId).toBeNull();
    } finally {
      act(() => useEditorModeStore.setState({ mode: "edit" }));
    }
  });

  it("rejects a request in read-only mode WITHOUT committing an already-open edit (Finding 5)", () => {
    // Regression test for guard ordering: `requestElementEdit` used to call
    // `commitElementEdit()` (flushing whatever edit was already open into
    // the scene) BEFORE its own `canEditScene` check — so the one write
    // this guard exists to prevent happened anyway, on the very call the
    // guard was meant to reject. The fix checks `canEditScene` first.
    const { container } = render(<EmbedLayer />);
    act(() => useEmbedPickerStore.getState().startPicking("e1"));

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const root = host.shadowRoot!;
    const button = root.querySelector("button")!;
    const spans = root.querySelectorAll("span");
    const buttonPath = buildElementPath(button, root);
    const spanPath = buildElementPath(spans[0], root);

    act(() => {
      useEmbedPickerStore.getState().requestElementEdit!(buttonPath);
    });
    act(() => {
      button.textContent = "Uncommitted edit";
    });

    act(() => useEditorModeStore.setState({ mode: "view" }));
    const updateSpy = vi.spyOn(useSceneStore.getState(), "updateNode");
    updateSpy.mockClear();

    let started = true;
    try {
      act(() => {
        started = useEmbedPickerStore.getState().requestElementEdit!(spanPath);
      });

      expect(started).toBe(false);
      // No commit ran: updateNode was never called with the uncommitted text.
      expect(updateSpy).not.toHaveBeenCalled();
      // The first edit's contenteditable session is untouched, not torn
      // down as a side effect of the rejected second request.
      expect(button.getAttribute("contenteditable")).toBe("plaintext-only");
      expect(button.textContent).toBe("Uncommitted edit");
      expect(useEmbedPickerStore.getState().editingEmbedId).toBe("e1");
    } finally {
      updateSpy.mockRestore();
      act(() => useEditorModeStore.setState({ mode: "edit" }));
    }
  });

  it("is null while no embed is picking, and is cleared again once picking stops", () => {
    const { container } = render(<EmbedLayer />);

    expect(useEmbedPickerStore.getState().requestElementEdit).toBeNull();

    act(() => useEmbedPickerStore.getState().startPicking("e1"));
    expect(useEmbedPickerStore.getState().requestElementEdit).toBeInstanceOf(Function);

    const host = container.querySelector<HTMLElement>('[data-embed-id="e1"]')!;
    const root = host.shadowRoot!;
    const button = root.querySelector("button")!;
    const path = buildElementPath(button, root);
    act(() => useEmbedPickerStore.getState().requestElementEdit!(path));
    expect(useEmbedPickerStore.getState().editingEmbedId).toBe("e1");

    act(() => useEmbedPickerStore.getState().stopPicking());

    // The picking effect's own teardown (keyed on `isPicking`) is what
    // clears the callback — mirrors `cancelElementDrag`/`cancelElementEdit`'s
    // lifecycle right above it in the same file.
    expect(useEmbedPickerStore.getState().requestElementEdit).toBeNull();
  });
});
