import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { usePluginPanelStore } from "@/store/pluginPanelStore";
import { usePluginStore } from "@/store/pluginStore";
import type { PenPlugin } from "@/lib/plugins/types";

const stopPlugin = vi.fn();
const getRunningPlugin = vi.fn<(id: string) => { plugin: PenPlugin } | undefined>(() => undefined);
vi.mock("@/lib/plugins/pluginHost", () => ({
  stopPlugin: (id: string) => stopPlugin(id),
  getRunningPlugin: (id: string) => getRunningPlugin(id),
}));

const { PluginPanels } = await import("../PluginPanels");

// happy-dom's `disableIframePageLoading` (vitest.config.ts) rejects a real
// navigation to "about:blank" once an iframe is connected to a live
// document; giving it `srcdoc` up front (as `pluginHost.runPlugin` always
// does) avoids that path entirely.
function makeIframe(): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.srcdoc = "<html></html>";
  return iframe;
}

function makePlugin(overrides: Partial<PenPlugin> = {}): PenPlugin {
  return {
    id: "p1",
    name: "Color picker",
    description: "",
    icon: "🎨",
    code: "",
    ui: { width: 320, height: 240 },
    source: "ai",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

/** The panel's titlebar reads name/icon live from `pluginStore` by id (see
 * `pluginPanelStore.ts` — the panel record itself only keeps geometry +
 * iframe, not a `PenPlugin` snapshot). Seed the same metadata there so the
 * titlebar has something to display, mirroring the real "already installed"
 * path (Manager Run / palette commands only ever run installed plugins). */
function installPlugin(plugin: PenPlugin): void {
  usePluginStore.setState({ plugins: [plugin], hydrated: true });
}

beforeEach(() => {
  usePluginPanelStore.setState({ panels: {} });
  usePluginStore.setState({ plugins: [], hydrated: false });
  stopPlugin.mockClear();
  getRunningPlugin.mockClear();
  getRunningPlugin.mockReturnValue(undefined);
});

afterEach(() => cleanup());

describe("<PluginPanels />", () => {
  it("renders nothing when no panels are open", () => {
    const { container } = render(<PluginPanels />);
    expect(container.querySelectorAll('[title="Resize"]').length).toBe(0);
  });

  it("renders a titlebar with the plugin's icon and name (from pluginStore), and mounts its iframe into the body", () => {
    const plugin = makePlugin();
    installPlugin(plugin);
    const iframe = makeIframe();
    usePluginPanelStore.getState().open(plugin.id, plugin.ui, iframe);
    render(<PluginPanels />);
    expect(screen.getByText("Color picker")).toBeTruthy();
    expect(screen.getByText("🎨")).toBeTruthy();
    expect(iframe.parentElement).not.toBeNull();
  });

  it("falls back to the running instance's plugin data when the id isn't in pluginStore (e.g. an ad-hoc/e2e plugin)", () => {
    const plugin = makePlugin({ id: "adhoc", name: "Ad-hoc" });
    getRunningPlugin.mockImplementation((id) => (id === "adhoc" ? { plugin } : undefined));
    usePluginPanelStore.getState().open(plugin.id, plugin.ui, makeIframe());
    render(<PluginPanels />);
    expect(screen.getByText("Ad-hoc")).toBeTruthy();
  });

  it("titlebar reflects a live rename instead of going stale", () => {
    const plugin = makePlugin({ name: "Before rename" });
    installPlugin(plugin);
    usePluginPanelStore.getState().open(plugin.id, plugin.ui, makeIframe());
    render(<PluginPanels />);
    expect(screen.getByText("Before rename")).toBeTruthy();

    act(() => {
      usePluginStore.setState({ plugins: [{ ...plugin, name: "After rename" }] });
    });
    expect(screen.queryByText("Before rename")).toBeNull();
    expect(screen.getByText("After rename")).toBeTruthy();
  });

  it("close button stops the plugin instance", () => {
    const plugin = makePlugin();
    installPlugin(plugin);
    usePluginPanelStore.getState().open(plugin.id, plugin.ui, makeIframe());
    render(<PluginPanels />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(stopPlugin).toHaveBeenCalledWith("p1");
  });

  it("renders one window per open panel", () => {
    usePluginStore.setState({
      plugins: [makePlugin({ id: "p1", name: "A" }), makePlugin({ id: "p2", name: "B" })],
      hydrated: true,
    });
    usePluginPanelStore.getState().open("p1", { width: 320, height: 240 }, makeIframe());
    usePluginPanelStore.getState().open("p2", { width: 320, height: 240 }, makeIframe());
    render(<PluginPanels />);
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
  });

  it("sizes the panel from the store's width/height", () => {
    const plugin = makePlugin();
    installPlugin(plugin);
    usePluginPanelStore.getState().open(plugin.id, plugin.ui, makeIframe());
    const { container } = render(<PluginPanels />);
    const panelEl = container.querySelector('[title="Resize"]')?.parentElement as HTMLElement;
    expect(panelEl.style.width).toBe("320px");
    expect(panelEl.style.height).toBe("240px");
  });
});
