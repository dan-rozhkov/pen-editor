import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TracePage from "@/routes/TracePage";
import { frameId, openTab, renderTrace, serveExtras, serveSample, stepButton } from "./traceTestUtils";

// The Step tab, the Before / After switch, the log filters, the request list and the step deep link.

const open = async (url?: string) => {
  renderTrace(url);
  await screen.findByTestId("trace-frame");
};
const cleanTab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });
/** The panel of the selected tab (a panel that was just left can linger in the document). */
const openPanel = () => document.getElementById(screen.getAllByRole("tab", { selected: true })[0]!.getAttribute("aria-controls")!)!;
const text = () => openPanel().textContent ?? "";

describe("trace inspector", () => {
  beforeEach(() => {
    serveSample();
    window.history.replaceState(null, "", "/trace/sample-trace-1?src=cloud");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.removeItem("pen.trace.detailsOpen");
  });

  describe("Step tab", () => {
    it("is the first tab and selected", async () => {
      await open();
      const tabs = within(screen.getByRole("tablist", { name: "Details" })).getAllByRole("tab");
      expect(tabs[0]!.textContent).toBe("Step");
      expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    });

    it("shows the tool, outcome, timing, arguments and output of the selected step", async () => {
      await open();
      fireEvent.click(stepButton(1));
      const panel = within(openPanel());
      expect(panel.getByRole("heading", { name: /open/ })).toBeTruthy();
      expect(panel.getByText("OK")).toBeTruthy();
      expect(panel.getByText("1.7 s · starts +0:00.2")).toBeTruthy();
      expect(text()).toContain('"url": "https://acme.test/"'); // args, pretty-printed
      expect(text()).toContain('"title": "Acme"'); // output, pretty-printed JSON
      expect(panel.getByRole("button", { name: "Copy arguments" })).toBeTruthy();
      expect(panel.getByRole("button", { name: "Copy output" })).toBeTruthy();
    });

    it("puts the full error of a failed step first, in the destructive tone", async () => {
      await open();
      fireEvent.click(stepButton(5));
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toBe("Element “Start free trial” was not found after 3000 ms");
      expect(alert.className).toContain("text-destructive");
      expect(within(openPanel()).getByText("Failed")).toBeTruthy();
    });

    it("lists the actions of a stopped batch and how many did not run", async () => {
      serveExtras();
      await open();
      fireEvent.click(stepButton(3));
      const items = within(openPanel()).getAllByRole("listitem");
      expect(items.map((li) => li.textContent)).toEqual(["click Pricing", "type EmailElement “Email” is disabled"]);
      expect(text()).toContain("1 not run");
    });

    it("copies the arguments, and a link to the step", async () => {
      const writeText = vi.fn(async () => {});
      vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
      await open();
      fireEvent.click(stepButton(1));
      fireEvent.click(screen.getByRole("button", { name: "Copy arguments" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"url"')));
      fireEvent.click(stepButton(4));
      fireEvent.click(screen.getByRole("button", { name: "Copy link to this step" }));
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expect.stringMatching(/\/trace\/sample-trace-1\?src=cloud&step=4$/)));
    });

    it("keeps the chosen tab when another step is selected", async () => {
      await open();
      openTab(/Network/);
      fireEvent.click(stepButton(4));
      expect(cleanTab("Network").getAttribute("aria-selected")).toBe("true");
    });

    it("says so when no step is selected", async () => {
      answerNoSteps();
      renderTrace();
      expect(await screen.findByText("No step selected")).toBeTruthy();
    });
  });

  describe("frames", () => {
    it("switches between the frame before a step and its own", async () => {
      await open();
      fireEvent.click(stepButton(3)); // step index 2: own frame 1, frame 0 before it
      const group = within(screen.getByRole("group", { name: "Frame view" }));
      expect(group.getByRole("button", { name: "After" }).getAttribute("aria-pressed")).toBe("true");
      expect(frameId()).toBe("1");
      fireEvent.click(group.getByRole("button", { name: "Before" }));
      expect(frameId()).toBe("0");
      expect(screen.getByTestId("trace-frame").getAttribute("alt")).toMatch(/^Before step/);
      fireEvent.click(stepButton(4)); // another step starts on After
      expect(within(screen.getByRole("group", { name: "Frame view" })).getByRole("button", { name: "After" }).getAttribute("aria-pressed")).toBe("true");
    });

    it("says when the frame shown is an earlier one", async () => {
      await open();
      fireEvent.click(stepButton(2)); // snapshot: no screenshot of its own
      expect(screen.getByTestId("frame-note").textContent).toBe("Earlier frame — this step took no screenshot");
      expect(screen.getByTestId("trace-frame").getAttribute("alt")).toMatch(/^Earlier frame/);
      expect(screen.queryByRole("group", { name: "Frame view" })).toBeNull(); // the same frame is both
      fireEvent.click(stepButton(3));
      expect(screen.queryByTestId("frame-note")).toBeNull();
    });

    it("shows a filmstrip pick as it is, without the switch", async () => {
      await open();
      fireEvent.click(stepButton(3));
      fireEvent.click(screen.getByRole("button", { name: /^Frame 4,/ }));
      expect(frameId()).toBe("3");
      expect(screen.queryByRole("group", { name: "Frame view" })).toBeNull();
      expect(screen.queryByTestId("frame-note")).toBeNull();
    });
  });

  describe("log filters", () => {
    it("narrows the console to the selected step and to a search text", async () => {
      await open();
      openTab(/Console/);
      expect(screen.getByTestId("console-count").textContent).toBe("2");
      fireEvent.click(stepButton(5)); // step index 4 owns the TypeError
      fireEvent.click(screen.getByRole("button", { name: "This step" }));
      expect(screen.getByTestId("console-count").textContent).toBe("1 of 2");
      expect(text()).toContain("TypeError");
      expect(text()).not.toContain("favicon");
      fireEvent.click(screen.getByRole("button", { name: "All" }));
      fireEvent.change(screen.getByRole("searchbox", { name: "Filter console" }), { target: { value: "FAVICON" } });
      expect(screen.getByTestId("console-count").textContent).toBe("1 of 2");
      expect(text()).not.toContain("TypeError");
      fireEvent.change(screen.getByRole("searchbox", { name: "Filter console" }), { target: { value: "zzz" } });
      expect(screen.getByText("Nothing matches")).toBeTruthy();
    });

    it("keeps the arrow keys and Space for the field while typing", async () => {
      await open();
      openTab(/Console/);
      const field = screen.getByRole("searchbox", { name: "Filter console" });
      fireEvent.keyDown(field, { key: "ArrowRight" });
      expect(stepButton(1).getAttribute("aria-current")).toBe("step");
      expect(screen.getByRole("button", { name: /^(Play|Pause)$/ }).getAttribute("aria-label")).toBe("Play");
      fireEvent.keyDown(field, { key: " " });
      expect(screen.getByRole("button", { name: /^(Play|Pause)$/ }).getAttribute("aria-label")).toBe("Play");
    });

    it("filters the failed-request list too, and keeps the filter across tabs", async () => {
      await open();
      openTab(/Network/);
      fireEvent.change(screen.getByRole("searchbox", { name: "Filter requests" }), { target: { value: "pricing" } });
      expect(screen.getByTestId("requests-count").textContent).toBe("1 of 2");
      openTab(/Console/);
      openTab(/Network/);
      expect((screen.getByRole("searchbox", { name: "Filter requests" }) as HTMLInputElement).value).toBe("pricing");
    });
  });

  describe("requests", () => {
    beforeEach(() => serveExtras());

    it("lists every request in time order and counts the failed ones on the tab", async () => {
      await open();
      expect(cleanTab("Network").textContent).toBe("Network 32 failed"); // 3 requests, 2 of them failed
      expect(cleanTab("Network").querySelector(".text-destructive")?.textContent).toBe("2 failed");
      openTab(/Network/);
      const rows = within(openPanel()).getAllByRole("button", { expanded: false });
      expect(rows.map((r) => r.textContent)).toEqual([
        expect.stringContaining("acme.test"),
        expect.stringContaining("acme.test/favicon.ico"),
        expect.stringContaining("acme.test/api/pricing/track"),
      ]);
      expect(within(rows[2]!).getByText("500").className).toContain("text-destructive");
      expect(within(rows[0]!).getByText("200").className).not.toContain("text-destructive");
      expect(within(rows[0]!).getByText("5.1 kB")).toBeTruthy();
      expect(within(rows[2]!).getByTestId("request-bar").style.left).toMatch(/^33\.33/);
    });

    it("shows only failed requests on request", async () => {
      await open();
      openTab(/Network/);
      fireEvent.click(screen.getByRole("button", { name: "Failed only" }));
      expect(screen.getByTestId("requests-count").textContent).toBe("2 of 3");
      expect(text()).not.toContain("acme.test/ ");
    });

    it("expands a row to its headers and response body", async () => {
      await open();
      openTab(/Network/);
      const row = screen.getByRole("button", { name: /api\/pricing\/track/ });
      expect(row.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(row);
      expect(row.getAttribute("aria-expanded")).toBe("true");
      const panel = within(openPanel());
      expect(panel.getByText("https://acme.test/api/pricing/track")).toBeTruthy();
      expect(panel.getByText("accept")).toBeTruthy();
      expect(panel.getByText("application/json")).toBeTruthy();
      expect(text()).toContain('"error": "boom"');
      expect(panel.getByText("Body truncated.")).toBeTruthy();
      fireEvent.click(row);
      expect(row.getAttribute("aria-expanded")).toBe("false");
      expect(row.hasAttribute("data-space-plays")).toBe(false); // Space presses the disclosure, not Play
    });
  });

  describe("deep link", () => {
    it("opens on the step named by ?step= and keeps the address in step with the selection", async () => {
      window.history.replaceState(null, "", "/trace/sample-trace-1?src=cloud&step=3");
      const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => (await import("@/components/trace/__fixtures__/sampleTrace")).sampleTraceJson() } as Response));
      vi.stubGlobal("fetch", fetchSpy);
      await open("/trace/sample-trace-1?src=cloud&step=3");
      expect(stepButton(3).getAttribute("aria-current")).toBe("step");
      expect(frameId()).toBe("1");
      fireEvent.click(stepButton(6));
      expect(window.location.search).toBe("?src=cloud&step=6");
      fireEvent.keyDown(window, { key: "ArrowLeft" });
      expect(window.location.search).toBe("?src=cloud&step=5");
      expect(fetchSpy).toHaveBeenCalledTimes(1); // the selection never reloads the trace
    });

    it("does not carry ?step= over to the next trace", async () => {
      let go: (to: string) => void = () => {};
      const Nav = () => {
        go = useNavigate();
        return null;
      };
      window.history.replaceState(null, "", "/trace/one?step=3");
      render(
        <MemoryRouter initialEntries={["/trace/one?step=3"]}>
          <Nav />
          <Routes>
            <Route path="/trace/:id" element={<TracePage />} />
          </Routes>
        </MemoryRouter>,
      );
      await screen.findByTestId("trace-frame");
      expect(stepButton(3).getAttribute("aria-current")).toBe("step");
      act(() => go("/trace/two"));
      await waitFor(() => expect(stepButton(1).getAttribute("aria-current")).toBe("step"));
    });

    it("ignores a step that does not exist and leaves a plain address alone until the selection moves", async () => {
      await open("/trace/sample-trace-1?step=99");
      expect(stepButton(1).getAttribute("aria-current")).toBe("step");
      expect(window.location.search).toBe("?src=cloud");
      fireEvent.click(stepButton(2));
      expect(window.location.search).toBe("?src=cloud&step=2");
    });
  });
});

function answerNoSteps() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ...(((await import("@/components/trace/__fixtures__/sampleTrace")).sampleTraceJson()) as object), steps: [], frames: [] }) })),
  );
}
