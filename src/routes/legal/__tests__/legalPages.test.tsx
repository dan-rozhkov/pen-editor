import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { LegalLinks } from "@/components/legal/LegalLinks";
import { AuthShell } from "@/components/auth/authUi";
import PrivacyPage from "../PrivacyPage";
import SupportPage from "../SupportPage";
import TermsPage from "../TermsPage";

afterEach(cleanup);

const ISSUES = "https://github.com/dan-rozhkov/pen-editor-plugin/issues";

describe("legal pages", () => {
  it.each([
    ["Privacy", PrivacyPage, "Privacy Policy", [/14 days/, /revoke access at any time/, /Cloudflare R2/, /PostHog/, /Steel/, /Tavily/, /fal\.ai/, /Quiver/, /Mobbin/, /OpenCode/, /Generative Language API/, /SHA-256 hash/, /linked to your account\s+identifier/, /until you ask us to delete them/, /become public in the gallery/]],
    ["Terms", TermsPage, "Terms of Service", [/as is/, /Limitation of liability/, /Acceptable use/]],
    ["Support", SupportPage, "Support", [/https:\/\/api\.sideform\.pro\/mcp/, /No Sideform editor is open/, /open_canvas/, /up to 15 minutes/, /stop working immediately/]],
  ] as const)("%s renders its heading, facts and contact", (_n, Page, heading, facts) => {
    const { container } = render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeTruthy();
    expect(container.textContent).toContain("Last updated: 5 October 2026");
    for (const fact of facts) expect(container.textContent).toMatch(fact);
    expect(container.textContent).toContain("open an issue titled");
    expect(container.textContent).not.toContain("mailbox");
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === ISSUES)).toBe(true);
  });

  it("links to all three pages", () => {
    render(<LegalLinks />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/privacy", "/terms", "/support"]);
  });

  it("AuthShell (sign-in, consent, account) carries the legal footer", () => {
    render(
      <AuthShell title="x">
        <p>body</p>
      </AuthShell>,
    );
    expect(screen.getByRole("navigation", { name: "Legal" })).toBeTruthy();
  });
});
