import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_DOM_AX, SAMPLE_DOM_HTML, sampleTraceWithDomsJson } from "../__fixtures__/sampleTrace";
import { buildDomSrcdoc, domCsp } from "../domSrcdoc";
import { cloudDomPath, readDomText } from "@/lib/trace/domText";
import { answer, renderTrace, serveDoms, serveSample, stepButton } from "./traceTestUtils";

// The Screenshot / DOM switch: step 3 (index 2) has an html snapshot, step 5 (index 4) an accessibility tree.

const open = async () => {
  renderTrace();
  await screen.findByTestId("trace-frame");
};
const GUARD = (remote: boolean) => `<meta http-equiv="Content-Security-Policy" content="${domCsp(remote)}"><base target="_blank">`;
const domSwitch = () => screen.queryByRole("group", { name: "Page view" });

describe("trace DOM snapshots", () => {
  beforeEach(() => window.history.replaceState(null, "", "/trace/sample-trace-1?src=cloud"));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows no switch and no badge for a trace without snapshots", async () => {
    serveSample();
    await open();
    fireEvent.click(stepButton(3));
    expect(domSwitch()).toBeNull();
    expect(screen.queryByText("DOM")).toBeNull();
  });

  it("shows the switch only on a step with a snapshot, and badges that step", async () => {
    serveDoms();
    await open();
    expect(domSwitch()).toBeNull();
    fireEvent.click(stepButton(3));
    expect(domSwitch()).not.toBeNull();
    expect(screen.getAllByText("DOM", { selector: "span" })).toHaveLength(2);
    fireEvent.click(stepButton(2));
    expect(domSwitch()).toBeNull();
  });

  it("starts on the screenshot and shows the html in an empty sandbox", async () => {
    serveDoms();
    await open();
    fireEvent.click(stepButton(3));
    expect(screen.getByRole("button", { name: "Screenshot" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("dom-frame")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "DOM" }));
    const frame = (await screen.findByTestId("dom-frame")) as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.title).toBe("DOM snapshot of step 3");
    const srcdoc = frame.getAttribute("srcdoc")!;
    expect(srcdoc).toBe(GUARD(false) + SAMPLE_DOM_HTML);
    expect(screen.queryByRole("link", { name: /new tab/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Screenshot" }));
    expect(screen.getByTestId("trace-frame")).toBeTruthy();
  });

  it("the toggle widens only img-src, off by default, and the sandbox stays empty", async () => {
    serveDoms();
    await open();
    fireEvent.click(stepButton(3));
    fireEvent.click(screen.getByRole("button", { name: "DOM" }));
    const frame = (await screen.findByTestId("dom-frame")) as HTMLIFrameElement;
    const toggle = screen.getByRole("checkbox", { name: "Load remote images" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(frame.getAttribute("srcdoc")).toContain("img-src data:;");
    fireEvent.click(toggle);
    expect(frame.getAttribute("srcdoc")).toContain("img-src data: https: http:;");
    expect(frame.getAttribute("srcdoc")).not.toContain("script-src");
    expect(frame.getAttribute("sandbox")).toBe("");
  });

  describe("buildDomSrcdoc", () => {
    const csp = "Content-Security-Policy";
    it("puts the guard first in an existing head, ahead of the page's own policy and base", () => {
      const out = buildDomSrcdoc(`<!doctype html><html><head lang="x"><meta http-equiv="${csp}" content="img-src *"><base href="https://evil.test/"></head><body></body></html>`, false);
      expect(out.indexOf(GUARD(false))).toBe(out.indexOf("<head lang=\"x\">") + "<head lang=\"x\">".length);
      expect(out.indexOf(GUARD(false))).toBeLessThan(out.indexOf("img-src *"));
    });
    it("handles a document without a head, with or without a doctype, and does not mistake <header>", () => {
      expect(buildDomSrcdoc("<p>x</p>", false)).toBe(`${GUARD(false)}<p>x</p>`);
      expect(buildDomSrcdoc("<!DOCTYPE html><p>x</p>", true)).toBe(`<!DOCTYPE html>${GUARD(true)}<p>x</p>`);
      expect(buildDomSrcdoc("<header>h</header>", false).startsWith(GUARD(false))).toBe(true);
    });
  });

  it("notes the source step of an accessibility tree taken earlier", async () => {
    const trace = sampleTraceWithDomsJson() as { doms: { stepIndex: number; sourceStepIndex?: number }[] };
    trace.doms[1]!.sourceStepIndex = 2;
    answer({ ok: true, status: 200, json: async () => trace });
    await open();
    fireEvent.click(stepButton(5));
    fireEvent.click(screen.getByRole("button", { name: "DOM" }));
    expect((await screen.findByTestId("dom-ax-source")).textContent).toBe("Accessibility tree from step 3 (no page change since)");
  });

  it("shows an accessibility tree as read-only text", async () => {
    serveDoms();
    await open();
    fireEvent.click(stepButton(5));
    fireEvent.click(screen.getByRole("button", { name: "DOM" }));
    const pre = await screen.findByTestId("dom-ax");
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toBe(SAMPLE_DOM_AX);
    expect(screen.queryByTestId("dom-frame")).toBeNull();
  });

  it("the choice is per snapshot: another step starts on the screenshot", async () => {
    serveDoms();
    await open();
    fireEvent.click(stepButton(3));
    fireEvent.click(screen.getByRole("button", { name: "DOM" }));
    await screen.findByTestId("dom-frame");
    fireEvent.click(stepButton(5));
    await waitFor(() => expect(screen.getByRole("button", { name: "Screenshot" }).getAttribute("aria-pressed")).toBe("true"));
  });

  describe("readDomText", () => {
    const signal = new AbortController().signal;
    const remote = { id: 3, at: 1, stepIndex: 1, kind: "html" as const, src: "https://bucket.test/t/dom/3.html", bytes: 8 };
    afterEach(() => vi.unstubAllGlobals());

    it("fetches a cloud trace's DOM through the backend route, never the bucket address", async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => "<b>x</b>" }));
      vi.stubGlobal("fetch", fetchMock);
      expect(await readDomText(remote, "tr 1", signal)).toBe("<b>x</b>");
      const [url] = fetchMock.mock.calls[0] as unknown as [string];
      expect(url).toContain("/api/browse/traces/tr%201/dom/3.html");
      expect(url).not.toContain("bucket.test");
      expect(cloudDomPath("a", { id: 2, kind: "ax" })).toBe("/api/browse/traces/a/dom/2.txt");
    });

    it("is unavailable for a non-data source without a cloud trace id (file or local)", async () => {
      await expect(readDomText(remote, undefined, signal)).rejects.toThrow("DOM snapshot is not available for this trace.");
    });

    it("rejects on a failed answer and on a data URL that is not text", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, text: async () => "" })));
      await expect(readDomText(remote, "t", signal)).rejects.toThrow("403");
      await expect(readDomText({ ...remote, src: "data:image/png;base64,AAAA" }, "t", signal)).rejects.toThrow();
    });
  });

  /** A cloud trace whose first DOM sits in the bucket; `domAnswer` is what the backend DOM route gives. */
  const serveRemoteDom = (domAnswer: Partial<Response>) => {
    const trace = sampleTraceWithDomsJson() as { doms: { src: string; url?: string; title?: string }[] };
    trace.doms[0]!.src = "https://bucket.test/t/dom/0.html";
    trace.doms[0]!.url = "https://acme.test/pricing";
    const fetchMock = vi.fn((url: string) => Promise.resolve(String(url).includes("/dom/") ? domAnswer : { ok: true, status: 200, json: async () => trace }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("a cloud trace reads the DOM through the backend route and shows the page address as plain text", async () => {
    const fetchMock = serveRemoteDom({ ok: true, status: 200, text: async () => "<p>from backend</p>" });
    await open();
    fireEvent.click(stepButton(3));
    fireEvent.click(screen.getByRole("button", { name: "DOM" }));
    const frame = (await screen.findByTestId("dom-frame")) as HTMLIFrameElement;
    expect(frame.getAttribute("srcdoc")).toBe(`${GUARD(false)}<p>from backend</p>`);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/browse/traces/sample-trace-1/dom/0.html"))).toBe(true);
    expect(urls.some((u) => u.includes("bucket.test"))).toBe(false);
    expect(screen.getByTestId("dom-where").textContent).toContain("https://acme.test/pricing");
    expect(screen.getByTestId("dom-where").querySelector("a")).toBeNull();
  });

  it("shows the reason when the backend cannot serve the DOM", async () => {
    serveRemoteDom({ ok: false, status: 404, text: async () => "" });
    await open();
    fireEvent.click(stepButton(3));
    fireEvent.click(screen.getByRole("button", { name: "DOM" }));
    expect(await screen.findByText("The DOM snapshot could not be loaded")).toBeTruthy();
    expect(screen.queryByTestId("dom-frame")).toBeNull();
  });
});
