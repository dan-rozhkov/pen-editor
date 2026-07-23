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
});
