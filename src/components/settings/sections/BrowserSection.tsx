import { useEffect, useState, useSyncExternalStore } from "react";

import { Switch } from "@/components/ui/switch";
import { traceFlag } from "@/lib/browseTracePref";
import {
  getDesktopBrowserSettings,
  hasDesktopBrowserSettings,
  setDesktopBrowserSettings,
  type DesktopBrowserSettings,
} from "@/lib/desktopBrowserSettings";

import { SettingsGroup, SettingsSection } from "../SettingsSection";

function DesktopBrowserRows() {
  // null until loaded: the switches stay disabled, so no wrong value flashes.
  const [values, setValues] = useState<DesktopBrowserSettings | null>(null);

  useEffect(() => {
    let alive = true;
    getDesktopBrowserSettings().then(
      (v) => alive && setValues(v),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (key: keyof DesktopBrowserSettings, next: boolean) => {
    setValues((cur) => (cur ? { ...cur, [key]: next } : cur));
    setDesktopBrowserSettings({ [key]: next }).catch(() => {
      setValues((cur) => (cur ? { ...cur, [key]: !next } : cur));
    });
  };

  return (
    <>
      <SettingsGroup
        inline
        title="Block ads and trackers"
        description="Block ads and tracking requests in the built-in browser. Pages load faster and the agent reads less noise."
      >
        <Switch
          aria-label="Block ads and trackers"
          checked={values?.adBlock ?? false}
          disabled={!values}
          onCheckedChange={(v) => toggle("adBlock", v)}
        />
      </SettingsGroup>
      <SettingsGroup
        inline
        title="Let MCP clients control the browser"
        description="Coding agents connected over MCP, such as Claude Code or Cursor, can open pages, read them and click in the built-in browser. They act on the sites you are signed in to there. Saved passwords are never shown to them."
      >
        <Switch
          aria-label="Let MCP clients control the browser"
          checked={values?.mcpBrowser ?? false}
          disabled={!values}
          onCheckedChange={(v) => toggle("mcpBrowser", v)}
        />
      </SettingsGroup>
    </>
  );
}

export function BrowserSection() {
  const allTraces = useSyncExternalStore(traceFlag.subscribe, traceFlag.get, () => false);

  return (
    <SettingsSection title="Browser">
      <SettingsGroup
        inline
        title="Record traces for all runs"
        description="Save a step-by-step trace of every browser run, not only QA tests. Screenshots of the visited pages are stored with it. On the web, traces are uploaded, and anyone with the link can open them."
      >
        <Switch aria-label="Record traces for all runs" checked={allTraces} onCheckedChange={traceFlag.set} />
      </SettingsGroup>
      {hasDesktopBrowserSettings() && <DesktopBrowserRows />}
    </SettingsSection>
  );
}
