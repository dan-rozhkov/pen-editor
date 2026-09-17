import { describe, expect, it } from "vitest";
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
