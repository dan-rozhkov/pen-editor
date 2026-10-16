import { describe, expect, it } from "vitest";
import { browseToolHint } from "../browseToolHint";

describe("browseToolHint", () => {
  it.each<[string, string, unknown, string | undefined]>([
    ["agent url host+path", "browse_agent", { url: "https://shop.test/cart/items" }, "shop.test/cart/items"],
    ["query and hash stripped", "browse_open", { url: "https://a.test/p?token=SECRET#frag" }, "a.test/p"],
    ["bare slash dropped", "browse_task", { url: "https://a.test/" }, "a.test"],
    ["port kept", "browse_open", { url: "http://localhost:3000/x" }, "localhost:3000/x"],
    ["invalid url", "browse_agent", { url: "not a url" }, undefined],
    ["missing url", "browse_open", {}, undefined],
    ["non-string url", "browse_task", { url: 5 }, undefined],
    ["non-object input", "browse_agent", "oops", undefined],
    ["long path segment masked", "browse_open", { url: "https://app.test/reset-password/eyJhbGciOiJIUzI1NiIsInR5cCI6" }, "app.test/reset-password/…"],
    ["short segments kept", "browse_open", { url: "https://app.test/a/b/c" }, "app.test/a/b/c"],
    ["whole hint clipped", "browse_task", { url: `https://app.test/${"abcdefghij/".repeat(8)}` }, `app.test/${"abcdefghij/".repeat(8)}`.slice(0, 48) + "…"],
    ["no hint for browse_act", "browse_act", { action: "type", target: "Password", text: "hunter2", key: "Enter" }, undefined],
    ["other tools", "browse_snapshot", { url: "https://a.test/" }, undefined],
  ])("%s", (_name, tool, input, expected) => {
    const hint = browseToolHint(tool, input);
    expect(hint).toBe(expected);
    expect(hint ?? "").not.toMatch(/hunter2|SECRET|frag|Enter/);
  });
});
