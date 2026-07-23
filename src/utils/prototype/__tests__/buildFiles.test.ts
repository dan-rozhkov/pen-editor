import { describe, it, expect } from "vitest";
import { wrapAsDocument, planPrototypeFiles } from "../buildFiles";

describe("wrapAsDocument", () => {
  it("produces a full standalone document", () => {
    const doc = wrapAsDocument("<h1>Hi</h1>", "Login");
    expect(doc).toMatch(/^<!DOCTYPE html>/);
    expect(doc).toContain("<title>Login</title>");
    expect(doc).toContain("<h1>Hi</h1>");
  });
});

describe("planPrototypeFiles", () => {
  it("emits one file per screen plus an index redirecting to the start screen", () => {
    const slugs = new Map([["a", "login"], ["b", "dashboard"]]);
    const files = planPrototypeFiles(
      [{ id: "a", name: "Login", linkedHtml: "<h1>Login</h1>" },
       { id: "b", name: "Dashboard", linkedHtml: "<h1>Dash</h1>" }],
      "b", slugs,
    );
    const names = files.map((f) => f.name).sort();
    expect(names).toEqual(["dashboard.html", "index.html", "login.html"]);
    const index = files.find((f) => f.name === "index.html")!;
    expect(index.content).toContain("url=dashboard.html");
  });
});
