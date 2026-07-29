import { describe, expect, it } from "vitest";
import { EMBED_UA_RESET_CSS, mountHtmlWithBodyStyles } from "../embedHtmlUtils";

// An embed mounts into a Shadow root, so the app's own reset never reaches it:
// an unstyled <button> renders in the browser's clothes (2px outset border,
// Arial) inside a design set in its own typeface. Every mount branch has to
// carry the neutralizing sheet, or the leak comes back through whichever one
// was missed.
function mount(html: string): HTMLElement {
  const container = document.createElement("div");
  mountHtmlWithBodyStyles(container, html, 390, 844);
  return container;
}

function resetSheet(container: HTMLElement): HTMLStyleElement | null {
  return container.querySelector("style[data-embed-ua-reset]");
}

describe("embed UA reset", () => {
  it("mounts the reset for a plain fragment", () => {
    const container = mount("<div><button>Go</button></div>");
    expect(resetSheet(container)?.textContent).toBe(EMBED_UA_RESET_CSS);
    expect(container.querySelector("button")?.textContent).toBe("Go");
  });

  it("mounts the reset for body-targeted HTML too", () => {
    // A `body{...}` selector alone puts the mount on its synthetic-<body>
    // branch; a full <html> document can't be built under happy-dom's
    // single-document-element rule, and the branch is the same either way.
    const container = mount("<style>body{background:#101416}</style><button>Go</button>");
    expect(resetSheet(container)?.textContent).toBe(EMBED_UA_RESET_CSS);
    // The embed's own body wrapper and content survive alongside it.
    expect(container.querySelector("body button")?.textContent).toBe("Go");
  });

  it("keeps every rule inside a cascade layer so embed CSS always wins", () => {
    expect(EMBED_UA_RESET_CSS.startsWith("@layer embed-ua-reset {")).toBe(true);
    expect(EMBED_UA_RESET_CSS.trimEnd().endsWith("}")).toBe(true);
  });

  it("does not blank out the inputs that ARE the native widget", () => {
    for (const type of ["checkbox", "radio", "range", "color", "file"]) {
      expect(EMBED_UA_RESET_CSS).not.toContain(`input[type="${type}"]`);
    }
  });
});
