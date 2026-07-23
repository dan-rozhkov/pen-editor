import { describe, it, expect } from "vitest";
import { extractPrototypeCandidates } from "../extractCandidates";

describe("extractPrototypeCandidates", () => {
  it("assigns stable data-proto-id to clickable elements and returns summaries", () => {
    const html = `<body><a href="/x">Home</a><button>Sign in</button><div>plain</div></body>`;
    const { annotatedHtml, candidates } = extractPrototypeCandidates(html);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ protoId: "p0", tag: "a", text: "Home", href: "/x" });
    expect(candidates[1]).toMatchObject({ protoId: "p1", tag: "button", text: "Sign in" });
    expect(annotatedHtml).toContain('data-proto-id="p0"');
    expect(annotatedHtml).toContain('data-proto-id="p1"');
  });

  it("includes role=button and [onclick], truncates long text, reads aria-label", () => {
    const html = `<div role="button" aria-label="Menu">${"x".repeat(200)}</div><span onclick="f()">Go</span>`;
    const { candidates } = extractPrototypeCandidates(html);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].ariaLabel).toBe("Menu");
    expect(candidates[0].text.length).toBeLessThanOrEqual(80);
    expect(candidates[1].text).toBe("Go");
  });

  it("captures <head> content (styles/links) so exported prototypes keep their CSS", () => {
    const html = `<head><style>.a{color:red}</style></head><body><button>Go</button></body>`;
    const { headHtml, annotatedHtml } = extractPrototypeCandidates(html);
    expect(headHtml).toContain(".a{color:red}");
    expect(annotatedHtml).not.toContain("<style>");
  });

  it("returns whitespace-collapsed visible text as contentText", () => {
    const html = `<body>  <h1>Welcome\n\nback</h1>  <p>Sign  in   below.</p></body>`;
    const { contentText } = extractPrototypeCandidates(html);
    expect(contentText).toBe("Welcome back Sign in below.");
  });

  it("caps contentText at ~1200 chars", () => {
    const html = `<body><p>${"x".repeat(2000)}</p></body>`;
    const { contentText } = extractPrototypeCandidates(html);
    expect(contentText.length).toBeLessThanOrEqual(1200);
  });

  it("extracts non-semantic clickable-looking elements (cards, tabs) common in design embeds", () => {
    // Real design embeds mark navigational cards/tabs as styled <div>s with no
    // <a>/<button>/role — the whole reason the plant-card → detail link failed.
    const html = `<body>
      <div class="plant-grid">
        <div class="plant-card"><div class="meta"><h4>Monstera Deliciosa</h4></div></div>
        <div class="plant-card"><div class="meta"><h4>Phalaenopsis</h4></div></div>
      </div>
      <div class="tab-bar">
        <div class="tab active">Home</div>
        <div class="tab">Garden</div>
      </div>
    </body>`;
    const { candidates } = extractPrototypeCandidates(html);
    const texts = candidates.map((c) => c.text);
    expect(texts).toContain("Monstera Deliciosa");
    expect(texts).toContain("Phalaenopsis");
    expect(texts).toContain("Home");
    expect(texts).toContain("Garden");
    // Container elements that only wrap other candidates must NOT be stamped
    // (would produce nested <a> and swallow per-item navigation).
    expect(texts).not.toContain("HomeGarden");
    expect(candidates.every((c) => c.text !== "Monstera DeliciosaPhalaenopsis")).toBe(true);
    // The class attribute is surfaced as a hint for the link-graph reasoner.
    const card = candidates.find((c) => c.text === "Monstera Deliciosa");
    expect(card?.classHint).toContain("plant-card");
  });

  it("keeps only the innermost match when clickables nest (semantic button inside a card)", () => {
    const html = `<body><div class="card"><span>Label</span><button>Buy</button></div></body>`;
    const { candidates } = extractPrototypeCandidates(html);
    // The card wraps a real <button>; only the button is stamped, so applying a
    // link never wraps a card in <a> around an inner <a>.
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ tag: "button", text: "Buy" });
  });

  it("does not stamp clickable-classed content nested inside an existing <a> (avoids nested anchors)", () => {
    // Designer already wrapped the card in a real anchor — the <a> is the
    // clickable, and its child must not become a second candidate (which
    // applyLinks would wrap in another <a>, nesting anchors).
    const html = `<body><a href="/detail"><div class="plant-card"><h4>Monstera</h4></div></a></body>`;
    const { candidates } = extractPrototypeCandidates(html);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].tag).toBe("a");
  });

  it("extracts elements with inline cursor:pointer styling", () => {
    const html = `<body><div style="cursor: pointer">Tap me</div></body>`;
    const { candidates } = extractPrototypeCandidates(html);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].text).toBe("Tap me");
  });
});
