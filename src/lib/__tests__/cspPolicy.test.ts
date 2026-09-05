import { describe, it, expect } from "vitest";
// The policy lives outside src/ because it is deployment configuration, not
// app code — nothing in the bundle reads it. It is tested here anyway: it is
// the one artifact where a careless edit silently removes the protection it
// claims to provide, and CI runs this suite.
import {
  CONTENT_SECURITY_POLICY,
  DIRECTIVES,
} from "../../../scripts/csp-policy.mjs";

describe("Content-Security-Policy", () => {
  it("never allows inline or eval'd script", () => {
    // The whole point of the policy. `style-src` may carry 'unsafe-inline'
    // (inline CSS cannot execute); `script-src` may not, and neither may
    // `default-src`, which is what script falls back to.
    for (const directive of ["script-src", "default-src"]) {
      expect(DIRECTIVES[directive]).not.toContain("'unsafe-inline'");
      expect(DIRECTIVES[directive]).not.toContain("'unsafe-eval'");
    }
  });

  it("never allows script from a scheme an injected string could forge", () => {
    // `script-src blob:`/`data:` would let injected code assemble a script
    // URL out of an attacker-controlled string and load it — a documented
    // bypass that makes the directive close to decorative.
    expect(DIRECTIVES["script-src"]).not.toContain("blob:");
    expect(DIRECTIVES["script-src"]).not.toContain("data:");
    expect(DIRECTIVES["script-src"]).not.toContain("https:");
    expect(DIRECTIVES["script-src"]).not.toContain("*");
  });

  it("keeps the directives that stop a page-level takeover from spreading", () => {
    expect(DIRECTIVES["object-src"]).toEqual(["'none'"]);
    expect(DIRECTIVES["base-uri"]).toEqual(["'self'"]);
    expect(DIRECTIVES["frame-ancestors"]).toEqual(["'none'"]);
    expect(DIRECTIVES["form-action"]).toEqual(["'self'"]);
  });

  it("serializes to a single well-formed header value", () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain(";;");
    expect(CONTENT_SECURITY_POLICY).not.toContain("\n");
    for (const name of Object.keys(DIRECTIVES)) {
      expect(CONTENT_SECURITY_POLICY).toContain(`${name} `);
    }
  });
});
