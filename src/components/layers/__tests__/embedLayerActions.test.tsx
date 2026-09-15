import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import {
  renameEmbedElement,
  toggleEmbedElementHidden,
  deleteEmbedElement,
  reorderEmbedElement,
} from "../embedLayerActions";
import { getEmbedElementLayerKey } from "../layerTypes";
import { useSceneStore } from "@/store/sceneStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { useEmbedPickerLifecycle } from "@/components/canvas/useEmbedPickerLifecycle";
import { useSelectionStore } from "@/store/selectionStore";
import { buildEmbedLayerTree, sourcePathToShadowPath } from "@/lib/embedLayerTree";
import * as embedHtmlDocument from "@/lib/embedHtmlDocument";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

const EMBED_ID = "embed1";

function seedEmbed(html: string): void {
  useSceneStore.setState({
    nodesById: {
      [EMBED_ID]: {
        id: EMBED_ID,
        type: "embed",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        htmlContent: html,
      } as unknown as FlatSceneNode,
    },
    parentById: { [EMBED_ID]: null },
    childrenById: {},
    rootIds: [EMBED_ID],
  });
  useSelectionStore.setState({ selectedIds: [EMBED_ID] });
}

function currentHtml(): string {
  return (useSceneStore.getState().nodesById[EMBED_ID] as unknown as { htmlContent: string }).htmlContent;
}

/** `buildEmbedLayerTree` (not the memoized `getEmbedLayerTree`) so tests
 * always see the tree for the exact html string they just seeded, even
 * across many tiny html variants in one file. */
function tree(html: string) {
  return buildEmbedLayerTree(html);
}

/** Mounted where a test needs `useEmbedPickerLifecycle`'s real synchronous
 * scene-store subscriber running, to prove the write-order invariant
 * end-to-end rather than just asserting on `embedPickerStore` state that a
 * broken write order would still happen to leave correct. */
function Harness() {
  useEmbedPickerLifecycle();
  return null;
}

describe("embedLayerActions", () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => cleanup());

  describe("renameEmbedElement", () => {
    it("writes data-layer-name and the tree picks it up", () => {
      const html = "<p>Hello</p>";
      seedEmbed(html);
      const path = tree(html)[0].shadowPath;

      expect(renameEmbedElement(EMBED_ID, path, "Title")).toBe(true);
      expect(currentHtml()).toContain('data-layer-name="Title"');
      expect(tree(currentHtml())[0].name).toBe("Title");
    });

    it("clears the name for an empty/whitespace value", () => {
      const html = '<p data-layer-name="Old">Hello</p>';
      seedEmbed(html);
      const path = tree(html)[0].shadowPath;

      expect(renameEmbedElement(EMBED_ID, path, "   ")).toBe(true);
      expect(currentHtml()).not.toContain("data-layer-name");
      // Falls back to the derived (text) name once the override is gone.
      expect(tree(currentHtml())[0].name).toBe("Hello");
    });

    it("returns false and writes nothing for a stale path", () => {
      const html = "<p>Hello</p>";
      seedEmbed(html);

      expect(renameEmbedElement(EMBED_ID, "div:nth-of-type(1) > span:nth-of-type(1)", "X")).toBe(false);
      expect(currentHtml()).toBe(html);
    });

    it("returns false for an unknown embed id", () => {
      seedEmbed("<p>Hello</p>");
      expect(renameEmbedElement("no-such-embed", "div:nth-of-type(1) > p:nth-of-type(1)", "X")).toBe(false);
    });
  });

  describe("toggleEmbedElementHidden", () => {
    it("hides and shows, round-tripping to the original html", () => {
      const html = "<div>Hi</div>";
      seedEmbed(html);
      const path = tree(html)[0].shadowPath;

      expect(toggleEmbedElementHidden(EMBED_ID, path, true)).toBe(true);
      expect(currentHtml()).toContain("display: none");
      expect(tree(currentHtml())[0].hidden).toBe(true);

      expect(toggleEmbedElementHidden(EMBED_ID, path, false)).toBe(true);
      expect(currentHtml()).toBe(html);
    });

    it("is a no-op (returns false) when the requested visibility already holds", () => {
      const html = "<div>Hi</div>";
      seedEmbed(html);
      const path = tree(html)[0].shadowPath;

      expect(toggleEmbedElementHidden(EMBED_ID, path, false)).toBe(false);
      expect(currentHtml()).toBe(html);
    });
  });

  describe("deleteEmbedElement", () => {
    it("removes the element and leaves the embed node alive", () => {
      const html = "<p>A</p><p>B</p>";
      seedEmbed(html);
      const path = tree(html)[0].shadowPath;

      expect(deleteEmbedElement(EMBED_ID, path)).toBe(true);
      expect(currentHtml()).not.toContain("A");
      expect(currentHtml()).toContain("B");
      expect(useSceneStore.getState().nodesById[EMBED_ID]).toBeTruthy();
    });

    it("clears the picker selection when the deleted element WAS the selection", () => {
      const html = "<p>A</p><p>B</p>";
      seedEmbed(html);
      const [a] = tree(html);
      useEmbedPickerStore.getState().selectElement(
        { embedId: EMBED_ID, path: a.shadowPath, tagName: "p", classes: [], textPreview: "A", outerHtml: "<p>A</p>" },
        html,
      );

      expect(deleteEmbedElement(EMBED_ID, a.shadowPath)).toBe(true);
      expect(useEmbedPickerStore.getState().selection).toBeNull();
    });

    it("clears the selection when deleting an ANCESTOR of the selected element", () => {
      const html = "<div><p>Child</p></div>";
      seedEmbed(html);
      const [div] = tree(html);
      const child = div.children[0];
      useEmbedPickerStore.getState().selectElement(
        { embedId: EMBED_ID, path: child.shadowPath, tagName: "p", classes: [], textPreview: "Child", outerHtml: "<p>Child</p>" },
        html,
      );

      expect(deleteEmbedElement(EMBED_ID, div.shadowPath)).toBe(true);
      expect(useEmbedPickerStore.getState().selection).toBeNull();
    });

    // Regression for finding #2: the deleted element's siblings AFTER it get
    // renumbered too (B was `p:nth-of-type(2)`, becomes `p:nth-of-type(1)`).
    // A selection that merely "wasn't the deleted element" must still be
    // re-pointed at its new path, not left on its old (now wrong, or
    // unresolvable) one — the original version of this test only asserted
    // `embedId` and a refreshed snapshot, which locked the stale-path bug
    // in rather than catching it.
    it("keeps an UNRELATED selection pointed at the SAME element, even though deletion renumbers it", () => {
      const html = "<p>A</p><p>B</p>";
      seedEmbed(html);
      const [a, b] = tree(html);
      useEmbedPickerStore.getState().selectElement(
        { embedId: EMBED_ID, path: b.shadowPath, tagName: "p", classes: [], textPreview: "B", outerHtml: "<p>B</p>" },
        html,
      );

      expect(deleteEmbedElement(EMBED_ID, a.shadowPath)).toBe(true);

      const selection = useEmbedPickerStore.getState().selection;
      expect(selection).not.toBeNull();
      expect(selection!.embedId).toBe(EMBED_ID);
      // B slid from nth-of-type(2) to nth-of-type(1) — the selection must
      // follow it there, not keep pointing at its old (now nonexistent) slot.
      expect(selection!.path).not.toBe(b.shadowPath);
      const newTree = tree(currentHtml());
      expect(newTree[0].name).toBe("B");
      expect(selection!.path).toBe(newTree[0].shadowPath);
      expect(useEmbedPickerStore.getState().selectionHtmlSnapshot).toBe(currentHtml());
    });

    it("returns false and writes nothing for a stale path", () => {
      const html = "<p>A</p>";
      seedEmbed(html);
      expect(deleteEmbedElement(EMBED_ID, "div:nth-of-type(1) > span:nth-of-type(1)")).toBe(false);
      expect(currentHtml()).toBe(html);
    });

    // Regression for finding #2: a delete renumbers surviving siblings the
    // same way a move does — the third section's expand key names
    // `section:nth-of-type(3)`, which the first section's removal shifts to
    // `section:nth-of-type(2)`. Before passing `{ trackExpandKeys: true }`
    // through, `deleteEmbedElement` left the stale key in place, so the
    // THIRD section silently collapsed (nothing in the tree resolves the old
    // key any more) while whatever now sits at `nth-of-type(2)` — here B —
    // reads as expanded instead.
    it("carries forward an UNRELATED sibling's expand-state key when a delete renumbers it", () => {
      const html =
        '<section id="a"><div>A</div></section><section id="b"><div>B</div></section><section id="c"><div>C</div></section>';
      seedEmbed(html);
      const [sa, , sc] = tree(html);
      const cKey = getEmbedElementLayerKey(EMBED_ID, sc.sourcePath);
      useSceneStore.setState({ expandedFrameIds: new Set([cKey]) });

      expect(deleteEmbedElement(EMBED_ID, sa.shadowPath)).toBe(true);

      const newTree = tree(currentHtml());
      expect(newTree.map((n) => n.name)).toEqual(["#b", "#c"]);
      const newC = newTree[1];
      const { expandedFrameIds } = useSceneStore.getState();
      expect(expandedFrameIds.has(cKey)).toBe(false);
      expect(expandedFrameIds.has(getEmbedElementLayerKey(EMBED_ID, newC.sourcePath))).toBe(true);
    });

    // Regression for finding #2, second half: the deleted element's OWN
    // expand-state key must also be dropped, not left dangling forever.
    it("removes the deleted element's own expand-state key", () => {
      const html = '<section id="a"><div>A</div></section><section id="b"><div>B</div></section>';
      seedEmbed(html);
      const [sa] = tree(html);
      const aKey = getEmbedElementLayerKey(EMBED_ID, sa.sourcePath);
      useSceneStore.setState({ expandedFrameIds: new Set([aKey]) });

      expect(deleteEmbedElement(EMBED_ID, sa.shadowPath)).toBe(true);

      expect(useSceneStore.getState().expandedFrameIds.has(aKey)).toBe(false);
    });
  });

  describe("reorderEmbedElement", () => {
    it("reorders 'before' within one embed", () => {
      const html = '<div class="row"><p id="a">A</p><p id="b">B</p></div>';
      seedEmbed(html);
      const [row] = tree(html);
      const [a, b] = row.children;

      expect(reorderEmbedElement(EMBED_ID, b.shadowPath, a.shadowPath, "before")).toBe(true);
      const newHtml = currentHtml();
      expect(newHtml.indexOf('id="b"')).toBeLessThan(newHtml.indexOf('id="a"'));
    });

    it("reorders 'after' within one embed", () => {
      const html = '<div class="row"><p id="a">A</p><p id="b">B</p></div>';
      seedEmbed(html);
      const [row] = tree(html);
      const [a, b] = row.children;

      expect(reorderEmbedElement(EMBED_ID, a.shadowPath, b.shadowPath, "after")).toBe(true);
      const newHtml = currentHtml();
      expect(newHtml.indexOf('id="b"')).toBeLessThan(newHtml.indexOf('id="a"'));
    });

    it("moves 'inside' a different container", () => {
      const html = '<div class="row"><p id="a">A</p></div><div id="target"></div>';
      seedEmbed(html);
      const [row, target] = tree(html);
      const [a] = row.children;

      expect(reorderEmbedElement(EMBED_ID, a.shadowPath, target.shadowPath, "inside")).toBe(true);
      const newHtml = currentHtml();
      expect(newHtml).toMatch(/<div id="target"><p id="a">A<\/p><\/div>/);
    });

    it("returns false and writes nothing for an illegal move (into its own descendant)", () => {
      const html = '<div id="outer"><p id="inner">Kid</p></div>';
      seedEmbed(html);
      const [outer] = tree(html);
      const inner = outer.children[0];

      expect(reorderEmbedElement(EMBED_ID, outer.shadowPath, inner.shadowPath, "inside")).toBe(false);
      expect(currentHtml()).toBe(html);
    });

    it("returns false for a true no-op move", () => {
      const html = '<div class="row"><p id="a">A</p><p id="b">B</p></div>';
      seedEmbed(html);
      const [row] = tree(html);
      const [a, b] = row.children;

      // "b" is already immediately after "a" — the pure mutation itself
      // rejects this as a no-op.
      expect(reorderEmbedElement(EMBED_ID, b.shadowPath, a.shadowPath, "after")).toBe(false);
      expect(currentHtml()).toBe(html);
    });

    it("re-points the picker selection at the MOVED element's new path, not whatever now sits at its old one", () => {
      const html = '<div class="row"><p id="a">A</p><p id="b">B</p></div><div id="target"></div>';
      seedEmbed(html);
      const [row, target] = tree(html);
      const [a] = row.children;
      const oldAPath = a.shadowPath;

      useEmbedPickerStore.getState().selectElement(
        { embedId: EMBED_ID, path: a.shadowPath, tagName: "p", classes: [], textPreview: "A", outerHtml: '<p id="a">A</p>' },
        html,
      );

      expect(reorderEmbedElement(EMBED_ID, a.shadowPath, target.shadowPath, "inside")).toBe(true);

      const selection = useEmbedPickerStore.getState().selection;
      expect(selection).not.toBeNull();
      // "B" slid up into "A"'s old slot — the selection must NOT have
      // stayed pointed at that now-stale path (which now resolves to B).
      expect(selection!.path).not.toBe(oldAPath);
      expect(selection!.textPreview).toBe("A");

      // `target` (now newTree[1]) really does contain "A" as its child at
      // the path the selection now points at.
      const newTree = tree(currentHtml());
      const movedA = newTree[1].children[0];
      expect(movedA.name).toBe("A");
      expect(selection!.path).toBe(movedA.shadowPath);
    });

    // Regression for finding #1: the old code only re-pointed the selection
    // when the MOVED element itself was selected (`wasSelected`). Here C is
    // selected and A is what's dragged — A's old move renumbers C's path
    // too (C was `p:nth-of-type(3)`, becomes `p:nth-of-type(2)`), so a
    // selection fixup that only ever looks at the moved element misses this
    // entirely and leaves the selection pointing at whatever slid into C's
    // OLD slot (which, after the move, is A).
    it("keeps a selection that is NOT the moved element pointed at the SAME element", () => {
      const html = "<p>A</p><p>B</p><p>C</p>";
      seedEmbed(html);
      const [a, , c] = tree(html);
      useEmbedPickerStore.getState().selectElement(
        { embedId: EMBED_ID, path: c.shadowPath, tagName: "p", classes: [], textPreview: "C", outerHtml: "<p>C</p>" },
        html,
      );

      expect(reorderEmbedElement(EMBED_ID, a.shadowPath, c.shadowPath, "after")).toBe(true);

      const selection = useEmbedPickerStore.getState().selection;
      expect(selection).not.toBeNull();
      expect(selection!.textPreview).toBe("C");
      const newTree = tree(currentHtml());
      expect(newTree.map((n) => n.name)).toEqual(["B", "C", "A"]);
      // C is now nth-of-type(2) — the selection must follow it there, not
      // stay on its old nth-of-type(3) slot (which A now occupies).
      expect(selection!.path).toBe(newTree[1].shadowPath);
    });

    // Regression for finding #5: a move renumbers same-tag siblings in BOTH
    // the old and new neighborhoods, not just inside the moved subtree —
    // moving A to after C also renumbers the UNRELATED, unmoved B and C.
    // An expand-state fix that only rewrites the moved subtree's own key
    // prefix (the pre-fix behavior) leaves B's stale key in place, which
    // after the move resolves to C — B silently collapses and C silently
    // reads as expanded.
    it("carries forward an UNRELATED sibling's expand-state key when a move renumbers it", () => {
      const html =
        '<section id="a"><div>A</div></section><section id="b"><div>B</div></section><section id="c"><div>C</div></section>';
      seedEmbed(html);
      const [sa, sb, sc] = tree(html);
      const bKey = getEmbedElementLayerKey(EMBED_ID, sb.sourcePath);
      useSceneStore.setState({ expandedFrameIds: new Set([bKey]) });

      expect(reorderEmbedElement(EMBED_ID, sa.shadowPath, sc.shadowPath, "after")).toBe(true);

      const newTree = tree(currentHtml());
      expect(newTree.map((n) => n.name)).toEqual(["#b", "#c", "#a"]);
      const newB = newTree[0];
      const newC = newTree[1];
      const { expandedFrameIds } = useSceneStore.getState();
      expect(expandedFrameIds.has(getEmbedElementLayerKey(EMBED_ID, newB.sourcePath))).toBe(true);
      expect(expandedFrameIds.has(getEmbedElementLayerKey(EMBED_ID, newC.sourcePath))).toBe(false);
    });

    it("carries forward expand-state entries for the moved subtree", () => {
      const html =
        '<div class="row"><div class="box"><div class="inner"><p>Kid</p></div></div></div><div id="target"></div>';
      seedEmbed(html);
      const [row, target] = tree(html);
      const box = row.children[0];
      const inner = box.children[0];
      const boxKey = getEmbedElementLayerKey(EMBED_ID, box.sourcePath);
      const innerKey = getEmbedElementLayerKey(EMBED_ID, inner.sourcePath);
      useSceneStore.setState({ expandedFrameIds: new Set([boxKey, innerKey]) });

      expect(reorderEmbedElement(EMBED_ID, box.shadowPath, target.shadowPath, "inside")).toBe(true);

      const { expandedFrameIds } = useSceneStore.getState();
      expect(expandedFrameIds.has(boxKey)).toBe(false);
      expect(expandedFrameIds.has(innerKey)).toBe(false);

      // `target` (now newTree[1]) contains the moved box as its only child,
      // box's only child is inner, matching the original nesting exactly —
      // only the paths (and therefore the keys) changed.
      const newTree = tree(currentHtml());
      const movedBox = newTree[1].children[0];
      const movedInner = movedBox.children[0];
      expect(movedInner.children[0].name).toBe("Kid");
      expect(expandedFrameIds.has(getEmbedElementLayerKey(EMBED_ID, movedBox.sourcePath))).toBe(true);
      expect(expandedFrameIds.has(getEmbedElementLayerKey(EMBED_ID, movedInner.sourcePath))).toBe(true);
    });
  });

  describe("body-targeted tracking (finding #3)", () => {
    // `resolveTrackableSourcePath` deliberately treats `""` (the source
    // `<body>` itself) as trackable — a picker selection can legitimately
    // name it. `findTracked`/`stripTrackMarkers` used `doc.body.querySelector
    // (All)`, which never matches `doc.body` ITSELF, only descendants — so a
    // body-targeted selection's marker was stamped but never found (the
    // selection was spuriously cleared even though the body trivially
    // "survived" every mutation) and never stripped (leaking `data-pen-track`
    // into the user's htmlContent forever, gaining a fresh token on every
    // later structural mutation).
    it("keeps a selection pointed at the BODY itself through an unrelated structural mutation", () => {
      // A literal `<body>` tag, not a bare fragment: `serializeEmbedDoc`
      // only emits `doc.body.innerHTML` (children only, no attributes) for a
      // bare fragment, so a marker stamped on `doc.body` itself could never
      // round-trip in that shape regardless of this fix — it needs the
      // `body`-only-fragment branch (`doc.body.outerHTML`, which DOES carry
      // the body's own attributes) to even have a chance of surviving.
      const html = "<body><p>A</p><p>B</p></body>";
      seedEmbed(html);
      const bodyShadowPath = sourcePathToShadowPath("", html);
      useEmbedPickerStore.getState().selectElement(
        { embedId: EMBED_ID, path: bodyShadowPath, tagName: "body", classes: [], textPreview: "", outerHtml: "" },
        html,
      );
      const [a] = tree(html);

      expect(deleteEmbedElement(EMBED_ID, a.shadowPath)).toBe(true);

      // Fails before the fix: the body-targeted marker is never found by
      // `findTracked`, so `applyStructuralMutation` treats the selection as
      // "didn't survive" and clears it.
      const selection = useEmbedPickerStore.getState().selection;
      expect(selection).not.toBeNull();
      expect(selection!.path).toBe(bodyShadowPath);
      // And the marker must not have leaked into the written html either.
      expect(currentHtml()).not.toContain("data-pen-track");
    });
  });

  describe("write-order invariant", () => {
    it("noteSelectionEdit lands before the scene write for a rename, so the lifecycle doesn't drop the selection", () => {
      const html = "<p>A</p>";
      seedEmbed(html);
      const path = tree(html)[0].shadowPath;
      useEmbedPickerStore.getState().selectElement(
        { embedId: EMBED_ID, path, tagName: "p", classes: [], textPreview: "A", outerHtml: "<p>A</p>" },
        html,
      );
      render(<Harness />);
      expect(useEmbedPickerStore.getState().selection).not.toBeNull();

      act(() => {
        renameEmbedElement(EMBED_ID, path, "Title");
      });

      // If the scene write had landed before `noteSelectionEdit`, the
      // lifecycle's synchronous subscriber would have seen `htmlContent`
      // diverge from the (stale) snapshot and cleared this.
      expect(useEmbedPickerStore.getState().selection).not.toBeNull();
    });

    it("noteSelectionEdit lands before the scene write for a hide toggle", () => {
      const html = "<div>Hi</div>";
      seedEmbed(html);
      const path = tree(html)[0].shadowPath;
      useEmbedPickerStore.getState().selectElement(
        { embedId: EMBED_ID, path, tagName: "div", classes: [], textPreview: "Hi", outerHtml: "<div>Hi</div>" },
        html,
      );
      render(<Harness />);

      act(() => {
        toggleEmbedElementHidden(EMBED_ID, path, true);
      });

      expect(useEmbedPickerStore.getState().selection).not.toBeNull();
    });

    // Regression for finding #1: the expand-state `setState` used to fire
    // AFTER the picker-store writes. B's expand key here is a bystander (not
    // the moved element, not the selection) whose path still gets renumbered
    // by the move — the exact case that flags `expandKeysChanged`. With the
    // old ordering, that intermediate `useSceneStore.setState` landed while
    // `selectionHtmlSnapshot` was already the NEW html (just written by
    // `selectElement` for C's re-pointed selection) but `embedNode.htmlContent`
    // was still the OLD one — `useEmbedPickerLifecycle`'s synchronous
    // subscriber read that as "html changed since pick" and cleared the very
    // selection this move had just carefully re-pointed.
    it("an expand-key write triggered by the SAME mutation does not drop the active selection", () => {
      const html =
        '<section id="a"><div>A</div></section><section id="b"><div>B</div></section><section id="c"><div>C</div></section>';
      seedEmbed(html);
      const [sa, sb, sc] = tree(html);
      const bKey = getEmbedElementLayerKey(EMBED_ID, sb.sourcePath);
      useSceneStore.setState({ expandedFrameIds: new Set([bKey]) });
      useEmbedPickerStore.getState().selectElement(
        { embedId: EMBED_ID, path: sc.shadowPath, tagName: "section", classes: [], textPreview: "C", outerHtml: '<section id="c"><div>C</div></section>' },
        html,
      );
      render(<Harness />);
      expect(useEmbedPickerStore.getState().selection).not.toBeNull();

      act(() => {
        // Moving A after C renumbers B's expand key
        // (section:nth-of-type(2) -> nth-of-type(1)) — this is what flags
        // `expandKeysChanged` — while C's selection is tracked at the same
        // time.
        reorderEmbedElement(EMBED_ID, sa.shadowPath, sc.shadowPath, "after");
      });

      const selection = useEmbedPickerStore.getState().selection;
      expect(selection).not.toBeNull();
      expect(selection!.textPreview).toBe("C");
    });

    it("the moved element's re-pointed selection survives the lifecycle's own check", () => {
      const html = '<div class="row"><p id="a">A</p></div><div id="target"></div>';
      seedEmbed(html);
      const [row, target] = tree(html);
      const [a] = row.children;
      useEmbedPickerStore.getState().selectElement(
        { embedId: EMBED_ID, path: a.shadowPath, tagName: "p", classes: [], textPreview: "A", outerHtml: '<p id="a">A</p>' },
        html,
      );
      render(<Harness />);

      act(() => {
        reorderEmbedElement(EMBED_ID, a.shadowPath, target.shadowPath, "inside");
      });

      const selection = useEmbedPickerStore.getState().selection;
      expect(selection).not.toBeNull();
      expect(selection!.textPreview).toBe("A");
    });
  });

  describe("defensive re-parse failure (finding #6)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    // `applyStructuralMutation` re-parses `mutate`'s own output to resolve
    // tracked elements by token. That re-parse is defensive — `mutate` just
    // produced valid html — but forcing it to fail here proves the branch
    // writes NOTHING rather than committing `resultHtml` with its
    // `data-pen-track` markers (stamped before `mutate` ran, stripped only on
    // the success path) still in it, which would leak them into the user's
    // htmlContent permanently.
    it("returns false and writes nothing when the mutated html fails to re-parse", () => {
      const html = "<p>A</p><p>B</p>";
      seedEmbed(html);
      const [a] = tree(html);
      useEmbedPickerStore.getState().selectElement(
        { embedId: EMBED_ID, path: a.shadowPath, tagName: "p", classes: [], textPreview: "A", outerHtml: "<p>A</p>" },
        html,
      );

      let calls = 0;
      vi.spyOn(embedHtmlDocument, "parseEmbedHtml").mockImplementation((h: string) => {
        calls += 1;
        // Calls 1 and 2 are the real parses `applyStructuralMutation` and
        // `removeEmbedElement` need to actually perform the delete; only the
        // THIRD call — re-parsing `mutate`'s result — is forced to fail.
        if (calls === 3) return null;
        return new DOMParser().parseFromString(h, "text/html");
      });

      expect(deleteEmbedElement(EMBED_ID, a.shadowPath)).toBe(false);
      expect(currentHtml()).toBe(html);
      expect(useEmbedPickerStore.getState().selection).not.toBeNull();
    });
  });

  describe("third-round review regressions", () => {
    // The expand-key rewrite used to delete/add into one Set as it walked
    // the tracked rows. When one row's NEW key equals a later row's OLD key
    // — the normal case once a run of same-tag siblings shifts — the later
    // iteration's delete removed what the earlier one had just added, and
    // which row lost its expansion depended on Set insertion order.
    it("keeps every expanded sibling when a delete shifts them into each other's keys", () => {
      const html = `<div><p>A</p><p>B</p><p>C</p></div>`;
      seedEmbed(html);
      const rows = tree(html)[0].children;
      const [a, b, c] = rows;
      // Insert C first, so a one-pass rewrite processes C before B and
      // B's new key (C's old key) gets deleted right after it is added.
      useSceneStore.setState({
        expandedFrameIds: new Set([
          getEmbedElementLayerKey(EMBED_ID, c.sourcePath),
          getEmbedElementLayerKey(EMBED_ID, b.sourcePath),
        ]),
      });

      expect(deleteEmbedElement(EMBED_ID, a.shadowPath)).toBe(true);

      const survivors = tree(currentHtml())[0].children;
      const expanded = useSceneStore.getState().expandedFrameIds;
      expect(expanded).toContain(getEmbedElementLayerKey(EMBED_ID, survivors[0].sourcePath));
      expect(expanded).toContain(getEmbedElementLayerKey(EMBED_ID, survivors[1].sourcePath));
      expect(expanded.size).toBe(2);
    });

    // A selection on the embed's content container (source path "") used to
    // be stamped with a tracking marker. For a bare-fragment embed
    // `serializeEmbedDoc` emits `body.innerHTML` and drops every <body>
    // attribute, so the marker never reached the mutated html, the element
    // read as "gone", and the container selection was cleared by any
    // unrelated delete or reorder. The container's path can never be
    // renumbered by a mutation of its descendants, so it needs no tracking.
    it("keeps a container-level selection through an unrelated delete in a bare fragment", () => {
      const html = `<div><p>A</p><p>B</p></div>`;
      seedEmbed(html);
      const rows = tree(html)[0].children;
      // The MOUNT CONTAINER, i.e. source path "" — not `tree(html)[0]`,
      // which is the outer <div> of the content itself.
      const containerPath = sourcePathToShadowPath("", html);
      useEmbedPickerStore.getState().selectElement(
        { embedId: EMBED_ID, path: containerPath, tagName: "div", classes: [], textPreview: "", outerHtml: "<div></div>" },
        html,
      );

      expect(deleteEmbedElement(EMBED_ID, rows[0].shadowPath)).toBe(true);

      const selection = useEmbedPickerStore.getState().selection;
      expect(selection).not.toBeNull();
      expect(selection?.path).toBe(containerPath);
      expect(currentHtml()).not.toContain("data-pen-track");
    });
  });
});
