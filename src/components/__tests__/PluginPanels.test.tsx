import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { usePluginPanelStore } from "@/store/pluginPanelStore";
import type { PenPlugin } from "@/lib/plugins/types";

const stopPlugin = vi.fn();
vi.mock("@/lib/plugins/pluginHost", () => ({
  stopPlugin: (id: string) => stopPlugin(id),
}));

const { PluginPanels } = await import("../plugins/PluginPanels");

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

beforeEach(() => {
  usePluginPanelStore.setState({ panels: {} });
  stopPlugin.mockClear();
});

afterEach(() => cleanup());

describe("<PluginPanels />", () => {
  it("renders nothing when no panels are open", () => {
    const { container } = render(<PluginPanels />);
    expect(container.querySelectorAll('[title="Resize"]').length).toBe(0);
  });

  it("renders a titlebar with the plugin's icon and name, and mounts its iframe into the body", () => {
    const iframe = makeIframe();
    usePluginPanelStore.getState().open(makePlugin(), iframe);
    render(<PluginPanels />);
    expect(screen.getByText("Color picker")).toBeTruthy();
    expect(screen.getByText("🎨")).toBeTruthy();
    expect(iframe.parentElement).not.toBeNull();
  });

  it("close button stops the plugin instance", () => {
    usePluginPanelStore.getState().open(makePlugin(), makeIframe());
    render(<PluginPanels />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(stopPlugin).toHaveBeenCalledWith("p1");
  });

  it("renders one window per open panel", () => {
    usePluginPanelStore.getState().open(makePlugin({ id: "p1", name: "A" }), makeIframe());
    usePluginPanelStore.getState().open(makePlugin({ id: "p2", name: "B" }), makeIframe());
    render(<PluginPanels />);
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
  });

  it("sizes the panel from the store's width/height", () => {
    usePluginPanelStore.getState().open(makePlugin(), makeIframe());
    const { container } = render(<PluginPanels />);
    const panelEl = container.querySelector('[title="Resize"]')?.parentElement as HTMLElement;
    expect(panelEl.style.width).toBe("320px");
    expect(panelEl.style.height).toBe("240px");
  });
});
