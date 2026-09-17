import { describe, expect, it, vi } from "vitest";
import {
  applyEditorVariableProperties,
  collectAuthoredRootCustomProperties,
  mountHtmlWithBodyStyles,
} from "../embedHtmlUtils";

// EmbedLayer.tsx's live-update effect calls applyEditorVariableProperties on
// every Variables-tab mutation, against the SAME container/root pairing
// mountHtmlWithBodyStyles returned at mount time. These tests exercise that
// contract directly, without a shadow root or React — `mountHtmlWithBodyStyles`
// works against a plain container either way.

describe("collectAuthoredRootCustomProperties", () => {
  it("harvests a :root declaration out of the embed's own <style> tag", () => {
    const container = document.createElement("div");
    container.innerHTML = "<style>:root { --accent: #ff0000; }</style><div>hi</div>";
    const authored = collectAuthoredRootCustomProperties(container);
    expect(authored.get("--accent")).toBe("#ff0000");
  });

  it("returns an empty map when the embed declares no root custom properties", () => {
    const container = document.createElement("div");
    container.innerHTML = "<style>.card { color: red; }</style><div>hi</div>";
    expect(collectAuthoredRootCustomProperties(container).size).toBe(0);
  });
});

describe("applyEditorVariableProperties", () => {
  it("sets editor variables as inline custom properties on the root", () => {
    const container = document.createElement("div");
    container.innerHTML = "<div>hi</div>";

    applyEditorVariableProperties(container, container, new Map([["--brand", "#00ff00"]]));

    expect(container.style.getPropertyValue("--brand")).toBe("#00ff00");
  });

  it("updates a variable's value on a later call", () => {
    const container = document.createElement("div");
    container.innerHTML = "<div>hi</div>";

    applyEditorVariableProperties(container, container, new Map([["--brand", "#00ff00"]]));
    applyEditorVariableProperties(container, container, new Map([["--brand", "#0000ff"]]));

    expect(container.style.getPropertyValue("--brand")).toBe("#0000ff");
  });

  it("editor values win over the embed's own authored :root declaration", () => {
    const container = document.createElement("div");
    container.innerHTML = "<style>:root { --brand: #101010; }</style><div>hi</div>";

    applyEditorVariableProperties(container, container, new Map([["--brand", "#00ff00"]]));

    expect(container.style.getPropertyValue("--brand")).toBe("#00ff00");
  });

  it("falls back to the embed's authored :root value when a variable is deleted", () => {
    const container = document.createElement("div");
    container.innerHTML = "<style>:root { --brand: #101010; }</style><div>hi</div>";

    applyEditorVariableProperties(container, container, new Map([["--brand", "#00ff00"]]));
    // The variable no longer exists in the editor's map (deleted, or renamed
    // away from this name).
    applyEditorVariableProperties(container, container, new Map());

    expect(container.style.getPropertyValue("--brand")).toBe("#101010");
  });

  it("removes the inline property outright when there is no authored fallback", () => {
    const container = document.createElement("div");
    container.innerHTML = "<div>hi</div>"; // no authored :root at all

    applyEditorVariableProperties(container, container, new Map([["--brand", "#00ff00"]]));
    applyEditorVariableProperties(container, container, new Map());

    expect(container.style.getPropertyValue("--brand")).toBe("");
  });

  it("never touches a custom property it did not itself apply", () => {
    const container = document.createElement("div");
    container.innerHTML = "<div>hi</div>";
    // Something else (e.g. the embed's own inline style) set this directly —
    // applyEditorVariableProperties must leave it alone since it was never
    // supplied through `vars`.
    container.style.setProperty("--unrelated", "keep-me");

    applyEditorVariableProperties(container, container, new Map([["--brand", "#00ff00"]]));
    applyEditorVariableProperties(container, container, new Map());

    expect(container.style.getPropertyValue("--unrelated")).toBe("keep-me");
  });

  it("re-harvests authored properties against `container` even when `root` is a nested synthetic <body>", () => {
    // Mirrors the body-targeted mount branch of mountHtmlWithBodyStyles:
    // authored <style> tags live on `container`, but the custom properties
    // must land on `root` (the synthetic <body> nested inside it).
    const container = document.createElement("div");
    const body = document.createElement("body");
    container.appendChild(document.createElement("style"));
    container.querySelector("style")!.textContent = ":root { --brand: #101010; }";
    container.appendChild(body);

    applyEditorVariableProperties(container, body, new Map([["--brand", "#00ff00"]]));
    expect(body.style.getPropertyValue("--brand")).toBe("#00ff00");

    applyEditorVariableProperties(container, body, new Map());
    expect(body.style.getPropertyValue("--brand")).toBe("#101010");
    expect(container.style.getPropertyValue("--brand")).toBe("");
  });
});

// F2: applyEditorVariableProperties must not re-harvest the embed's authored
// <style> tags (collectAuthoredRootCustomProperties, a full CSSOM parse per
// tag) unless a name is actually about to be reverted. EmbedLayer mounts
// every visible embed and re-runs this on every useVariableStore mutation,
// so an unconditional harvest turns a single value update — the common case,
// e.g. dragging a color slider — into a full stylesheet re-parse per embed
// per pointermove.
describe("applyEditorVariableProperties — harvest gating (perf)", () => {
  it("does not re-harvest authored <style> tags when nothing needs reverting", () => {
    const container = document.createElement("div");
    container.innerHTML = "<style>:root { --brand: #101010; }</style><div>hi</div>";
    // collectAuthoredRootCustomProperties (the full CSSOM-parse harvest)
    // calls `container.querySelectorAll("style")` as its very first step —
    // spying there is a direct proxy for "did a re-harvest happen".
    const qsaSpy = vi.spyOn(container, "querySelectorAll");

    applyEditorVariableProperties(container, container, new Map([["--brand", "#00ff00"]]));
    expect(qsaSpy).not.toHaveBeenCalled(); // first call: nothing previously applied, nothing to revert

    applyEditorVariableProperties(container, container, new Map([["--brand", "#0000ff"]]));
    expect(qsaSpy).not.toHaveBeenCalled(); // second call: same name still supplied — an update, not a revert

    applyEditorVariableProperties(container, container, new Map([["--brand", "#0000ff"], ["--accent", "#ff00ff"]]));
    expect(qsaSpy).not.toHaveBeenCalled(); // adding a NEW name is not a revert of any previously-applied name either

    applyEditorVariableProperties(container, container, new Map());
    expect(qsaSpy).toHaveBeenCalledTimes(1); // NOW something (--brand, --accent) needs reverting

    qsaSpy.mockRestore();
  });
});

// F3: the revert path's only fallback used to be the embed's authored :root
// <style> rules — but for a body-targeted embed, mountHtmlWithBodyStyles
// copies the author's own <body style="--brand:..."> inline declaration onto
// the synthetic body it mounts as `root`. The first applyEditorVariableProperties
// call overwrites that inline value; deleting the editor variable must bring
// it back rather than losing it (falling through to nothing, or wrongly to
// an unrelated :root rule).
describe("applyEditorVariableProperties — captured original inline value (F3)", () => {
  it("restores the root's own pre-existing inline value on revert, in preference to an authored :root rule", () => {
    const container = document.createElement("div");
    // Both sources exist for --brand: an authored :root rule AND (simulating
    // mountHtmlWithBodyStyles copying <body style="--brand:...">) a
    // pre-existing INLINE value directly on `root`. The inline value must win.
    container.innerHTML = "<style>:root { --brand: #101010; }</style>";
    const root = document.createElement("div");
    root.style.setProperty("--brand", "#222222"); // author's own inline declaration
    container.appendChild(root);

    applyEditorVariableProperties(container, root, new Map([["--brand", "#00ff00"]]));
    expect(root.style.getPropertyValue("--brand")).toBe("#00ff00");

    applyEditorVariableProperties(container, root, new Map()); // revert
    expect(root.style.getPropertyValue("--brand")).toBe("#222222"); // captured inline, not the :root rule
  });

  it("falls back to the authored :root rule when there was no pre-existing inline value", () => {
    const container = document.createElement("div");
    container.innerHTML = "<style>:root { --brand: #101010; }</style>";
    const root = document.createElement("div");
    container.appendChild(root); // no inline --brand on root before the first apply

    applyEditorVariableProperties(container, root, new Map([["--brand", "#00ff00"]]));
    expect(root.style.getPropertyValue("--brand")).toBe("#00ff00");

    applyEditorVariableProperties(container, root, new Map()); // revert
    expect(root.style.getPropertyValue("--brand")).toBe("#101010"); // authored :root fallback
  });
});

describe("mountHtmlWithBodyStyles + applyEditorVariableProperties integration", () => {
  it("live-updates the actual mounted root returned by mountHtmlWithBodyStyles", () => {
    const container = document.createElement("div");
    const { root } = mountHtmlWithBodyStyles(
      container,
      "<style>body{background:#101416}</style><main>Wallet</main>",
      390,
      844,
    );

    applyEditorVariableProperties(container, root, new Map([["--brand", "#00ff00"]]));
    expect(root.style.getPropertyValue("--brand")).toBe("#00ff00");

    applyEditorVariableProperties(container, root, new Map([["--brand", "#0000ff"]]));
    expect(root.style.getPropertyValue("--brand")).toBe("#0000ff");
  });
});
