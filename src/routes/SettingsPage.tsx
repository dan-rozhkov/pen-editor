import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router";

import { EditorProviders } from "@/components/EditorProviders";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { AccountSection } from "@/components/settings/sections/AccountSection";
import { AgentSection } from "@/components/settings/sections/AgentSection";
import { AppearanceSection } from "@/components/settings/sections/AppearanceSection";
import { BrowserSection } from "@/components/settings/sections/BrowserSection";
import { CanvasSection } from "@/components/settings/sections/CanvasSection";
import { IntegrationsSection } from "@/components/settings/sections/IntegrationsSection";
import { ShortcutsSection } from "@/components/settings/sections/ShortcutsSection";
import { useHtmlRouteClass } from "@/hooks/useHtmlRouteClass";
import { parseSettingsSection, SETTINGS_SECTION_EVENT, type SettingsSection } from "@/lib/openSettings";

const SECTION_VIEWS: Record<SettingsSection, () => React.JSX.Element> = {
  account: AccountSection,
  appearance: AppearanceSection,
  canvas: CanvasSection,
  agent: AgentSection,
  browser: BrowserSection,
  integrations: IntegrationsSection,
  shortcuts: ShortcutsSection,
};

/**
 * "/settings": two-column settings (desktop tab `/settings?chat=off&section=<id>`
 * or a plain browser page). Writes localStorage from its own document; the
 * other tabs follow through `storage` events and the theme BroadcastChannel.
 * Must not import App or Pixi.
 */
export default function SettingsPage() {
  useHtmlRouteClass("route-settings");
  const [params, setParams] = useSearchParams();
  const section = parseSettingsSection(params.get("section"));

  useEffect(() => {
    document.title = "Settings";
  }, []);

  const select = useCallback(
    (next: SettingsSection) =>
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          out.set("section", next);
          return out;
        },
        { replace: true },
      ),
    [setParams],
  );

  // openSettings(section) while this page is showing.
  useEffect(() => {
    const onSection = (e: Event) => select(parseSettingsSection((e as CustomEvent<string>).detail));
    window.addEventListener(SETTINGS_SECTION_EVENT, onSection);
    const offDesktop = window.penDesktop?.settings?.onSection?.((id) => select(parseSettingsSection(id)));
    return () => {
      window.removeEventListener(SETTINGS_SECTION_EVENT, onSection);
      offDesktop?.();
    };
  }, [select]);

  const View = SECTION_VIEWS[section];
  return (
    <EditorProviders>
      <div className="flex h-dvh flex-col overflow-hidden bg-surface-panel text-text-primary md:flex-row">
        <SettingsNav active={section} onSelect={select} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-10 md:py-8">
            <View />
          </div>
        </main>
      </div>
    </EditorProviders>
  );
}
