import { describe, it, expect } from "vitest";
import { buildPrototypeFiles } from "../index";

describe("buildPrototypeFiles", () => {
  it("wires screens end-to-end with an injected link resolver", async () => {
    const embeds = [
      { id: "a", name: "Login", x: 0, y: 0, html: `<button>Sign in</button>` },
      { id: "b", name: "Dashboard", x: 400, y: 0, html: `<h1>Dashboard</h1>` },
    ];
    const files = await buildPrototypeFiles(embeds, async () => [
      { screenId: "a", protoId: "p0", targetScreenId: "b" },
    ]);
    const names = files.map((f) => f.name).sort();
    expect(names).toEqual(["dashboard.html", "index.html", "login.html"]);
    const login = files.find((f) => f.name === "login.html")!;
    expect(login.content).toMatch(/<a href="dashboard\.html"><button>Sign in<\/button><\/a>/);
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
        html: `<head><style>.brand{color:red}</style></head><body><button class="brand">Sign in</button></body>`,
      },
      { id: "b", name: "Dashboard", x: 400, y: 0, html: `<h1>Dashboard</h1>` },
    ];
    const files = await buildPrototypeFiles(embeds, async () => []);
    const login = files.find((f) => f.name === "login.html")!;
    expect(login.content).toContain(".brand{color:red}");
  });
});
