import { describe, it, expect } from "vitest";
import { heuristicPrototypeLinks } from "../heuristicLinks";

describe("heuristicPrototypeLinks", () => {
  it("links a candidate whose text exactly matches another screen's name", () => {
    const links = heuristicPrototypeLinks([
      {
        slug: "login",
        name: "Login",
        candidates: [{ protoId: "p0", text: "Pricing" }],
      },
      { slug: "pricing", name: "Pricing", candidates: [] },
    ]);
    expect(links).toEqual([{ screenId: "login", protoId: "p0", targetScreenId: "pricing" }]);
  });

  it("is case-insensitive", () => {
    const links = heuristicPrototypeLinks([
      { slug: "login", name: "Login", candidates: [{ protoId: "p0", text: "PRICING" }] },
      { slug: "pricing", name: "Pricing", candidates: [] },
    ]);
    expect(links).toEqual([{ screenId: "login", protoId: "p0", targetScreenId: "pricing" }]);
  });

  it("matches on a whole-word contains against the screen name (e.g. 'View pricing')", () => {
    const links = heuristicPrototypeLinks([
      { slug: "login", name: "Login", candidates: [{ protoId: "p0", text: "View pricing" }] },
      { slug: "pricing", name: "Pricing", candidates: [] },
    ]);
    expect(links).toEqual([{ screenId: "login", protoId: "p0", targetScreenId: "pricing" }]);
  });

  it("matches on aria-label when text doesn't match", () => {
    const links = heuristicPrototypeLinks([
      {
        slug: "login",
        name: "Login",
        candidates: [{ protoId: "p0", text: "", ariaLabel: "Go to Dashboard" }],
      },
      { slug: "dashboard", name: "Dashboard", candidates: [] },
    ]);
    expect(links).toEqual([{ screenId: "login", protoId: "p0", targetScreenId: "dashboard" }]);
  });

  it("matches against a multi-word slug with hyphens replaced by spaces", () => {
    const links = heuristicPrototypeLinks([
      { slug: "login", name: "Login", candidates: [{ protoId: "p0", text: "Sign up now" }] },
      { slug: "sign-up", name: "Create Account", candidates: [] },
    ]);
    expect(links).toEqual([{ screenId: "login", protoId: "p0", targetScreenId: "sign-up" }]);
  });

  it("never emits a self-link", () => {
    const links = heuristicPrototypeLinks([
      { slug: "pricing", name: "Pricing", candidates: [{ protoId: "p0", text: "Pricing" }] },
    ]);
    expect(links).toEqual([]);
  });

  it("produces no link when nothing matches", () => {
    const links = heuristicPrototypeLinks([
      { slug: "login", name: "Login", candidates: [{ protoId: "p0", text: "Forgot password?" }] },
      { slug: "dashboard", name: "Dashboard", candidates: [] },
    ]);
    expect(links).toEqual([]);
  });

  it("skips generic labels for fuzzy matching (no false positive)", () => {
    const links = heuristicPrototypeLinks([
      { slug: "login", name: "Login", candidates: [{ protoId: "p0", text: "Next" }] },
      { slug: "next-steps", name: "Next Steps", candidates: [] },
    ]);
    expect(links).toEqual([]);
  });

  it("still links a generic-looking label when it exactly names a screen", () => {
    const links = heuristicPrototypeLinks([
      { slug: "login", name: "Login", candidates: [{ protoId: "p0", text: "Next" }] },
      { slug: "next", name: "Next", candidates: [] },
    ]);
    expect(links).toEqual([{ screenId: "login", protoId: "p0", targetScreenId: "next" }]);
  });

  it("skips ambiguous matches against multiple screens", () => {
    const links = heuristicPrototypeLinks([
      { slug: "login", name: "Login", candidates: [{ protoId: "p0", text: "Home" }] },
      { slug: "home", name: "Home", candidates: [] },
      { slug: "home-2", name: "Home", candidates: [] },
    ]);
    expect(links).toEqual([]);
  });

  it("emits at most one link per candidate even with multiple label sources", () => {
    const links = heuristicPrototypeLinks([
      {
        slug: "login",
        name: "Login",
        candidates: [{ protoId: "p0", text: "Pricing", ariaLabel: "Pricing" }],
      },
      { slug: "pricing", name: "Pricing", candidates: [] },
    ]);
    expect(links).toHaveLength(1);
  });

  it("links multiple independent candidates on the same screen", () => {
    const links = heuristicPrototypeLinks([
      {
        slug: "login",
        name: "Login",
        candidates: [
          { protoId: "p0", text: "Pricing" },
          { protoId: "p1", text: "Dashboard" },
        ],
      },
      { slug: "pricing", name: "Pricing", candidates: [] },
      { slug: "dashboard", name: "Dashboard", candidates: [] },
    ]);
    expect(links.sort((a, b) => a.protoId.localeCompare(b.protoId))).toEqual([
      { screenId: "login", protoId: "p0", targetScreenId: "pricing" },
      { screenId: "login", protoId: "p1", targetScreenId: "dashboard" },
    ]);
  });
});
