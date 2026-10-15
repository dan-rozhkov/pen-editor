import { describe, expect, it } from "vitest";
import { redactBrowseSetupInput } from "../redactBrowseSetupInput";

describe("redactBrowseSetupInput", () => {
  const input = {
    goal: "g",
    setup: {
      steps: [{ action: "type", selector: "#p", text: "S1" }, { action: "click", selector: "#b" }],
      network: [{ url: "https://api/*", status: 200, body: "S2", headers: { authorization: "S3" } }],
      storage: {
        cookies: [{ name: "sid", value: "S4", domain: "a.test" }],
        origins: [{ origin: "https://a.test", localStorage: { k: "S5", k2: "S6" }, sessionStorage: { k3: "S7" } }],
      },
    },
  };

  it("hides values, keeps structure, never mutates", () => {
    const snapshot = JSON.stringify(input);
    const out = JSON.stringify(redactBrowseSetupInput(input));
    expect(JSON.stringify(input)).toBe(snapshot);
    for (const s of ["S1", "S2", "S3", "S4", "S5", "S6", "S7", '"k"', '"k3"']) expect(out).not.toContain(s);
    expect(out).toContain('"selector":"#b"');
    expect(out).toContain('"name":"sid"');
    expect(out).toContain('"2 keys":"[hidden]"');
    expect(out).toContain('"authorization":"[hidden]"');
  });

  it("passes through inputs without setup", () => {
    const plain = { goal: "g" };
    expect(redactBrowseSetupInput(plain)).toBe(plain);
    expect(redactBrowseSetupInput(undefined)).toBeUndefined();
  });
});
