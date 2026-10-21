import { useSyncExternalStore } from "react";

import { Switch } from "@/components/ui/switch";
import { traceFlag } from "@/lib/browseTracePref";

import { SettingsGroup, SettingsSection } from "../SettingsSection";

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
    </SettingsSection>
  );
}
