import { describe, it, expect } from "vitest";
import { buildPrototypeFiles } from "../index";

describe("buildPrototypeFiles", () => {
  it("wires screens end-to-end with an injected link resolver, keyed by slug", async () => {
    const embeds = [
      { id: "a", name: "Login", x: 0, y: 0, html: `<button>Continue</button>` },
      { id: "b", name: "Dashboard", x: 400, y: 0, html: `<h1>Dashboard</h1>` },
    ];
    const files = await buildPrototypeFiles(embeds, async (screens) => {
      // The resolver receives slug-keyed ids, not embed node ids.
      expect(screens.map((s) => s.id).sort()).toEqual(["dashboard", "login"]);
      return [{ screenId: "login", protoId: "p0", targetScreenId: "dashboard" }];
    });
    const names = files.map((f) => f.name).sort();
    expect(names).toEqual(["dashboard.html", "index.html", "login.html"]);
    const login = files.find((f) => f.name === "login.html")!;
    expect(login.content).toMatch(/<a href="dashboard\.html" style="[^"]*"><button>Continue<\/button><\/a>/);
    const index = files.find((f) => f.name === "index.html")!;
    expect(index.content).toContain("url=login.html"); // start screen = top-left (a)
  });

  it("preserves <head> styles the parser hoisted out of the fragment", async () => {
    // In a real browser a top-level <style>/<link> lands in <head>, not <body>
    // (the embed renderer hoists head childNodes for exactly this reason).
    // Reading only body.innerHTML would drop all CSS from the exported prototype.
    const embeds = [
      {
        id: "a",
        name: "Login",
        x: 0,
        y: 0,
        html: `<head><style>.brand{color:red}</style></head><body><button class="brand">Continue</button></body>`,
      },
      { id: "b", name: "Dashboard", x: 400, y: 0, html: `<h1>Dashboard</h1>` },
    ];
    const files = await buildPrototypeFiles(embeds, async () => []);
    const login = files.find((f) => f.name === "login.html")!;
    expect(login.content).toContain(".brand{color:red}");
  });

  it("links via the heuristic even when the model resolver returns nothing", async () => {
    const embeds = [
      { id: "a", name: "Login", x: 0, y: 0, html: `<a>View pricing</a>` },
      { id: "b", name: "Pricing", x: 400, y: 0, html: `<h1>Pricing</h1>` },
    ];
    const files = await buildPrototypeFiles(embeds, async () => []);
    const login = files.find((f) => f.name === "login.html")!;
    expect(login.content).toMatch(/<a href="pricing\.html">View pricing<\/a>/);
  });

  it("falls back to heuristic links when fetchLinks rejects", async () => {
    const embeds = [
      { id: "a", name: "Login", x: 0, y: 0, html: `<a>Pricing</a>` },
      { id: "b", name: "Pricing", x: 400, y: 0, html: `<h1>Pricing</h1>` },
    ];
    const files = await buildPrototypeFiles(embeds, async () => {
      throw new Error("backend down");
    });
    const login = files.find((f) => f.name === "login.html")!;
    expect(login.content).toMatch(/<a href="pricing\.html">Pricing<\/a>/);
  });

  it("prefers the heuristic link over a conflicting model link for the same candidate", async () => {
    const embeds = [
      { id: "a", name: "Login", x: 0, y: 0, html: `<a>Pricing</a>` },
      { id: "b", name: "Pricing", x: 400, y: 0, html: `<h1>Pricing</h1>` },
      { id: "c", name: "Other", x: 800, y: 0, html: `<h1>Other</h1>` },
    ];
    const files = await buildPrototypeFiles(embeds, async () => [
      { screenId: "login", protoId: "p0", targetScreenId: "other" },
    ]);
    const login = files.find((f) => f.name === "login.html")!;
    expect(login.content).toMatch(/<a href="pricing\.html">Pricing<\/a>/);
  });
});
