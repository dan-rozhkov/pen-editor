import { useSyncExternalStore } from "react";

import { Switch } from "@/components/ui/switch";
import { generationRevealFlag } from "@/lib/embedGenerationReveal";
import { rasterCacheFlag } from "@/lib/rasterCachePref";
import { streamingMutationsFlag } from "@/lib/streamingTools/types";
import type { StorageFlag } from "@/lib/storageSync";

import { SettingsGroup, SettingsSection } from "../SettingsSection";

function FlagRow({ flag, title, description }: { flag: StorageFlag; title: string; description: string }) {
  const on = useSyncExternalStore(flag.subscribe, flag.get, () => true);
  return (
    <SettingsGroup inline title={title} description={description}>
      <Switch checked={on} onCheckedChange={flag.set} aria-label={title} />
    </SettingsGroup>
  );
}

export function AdvancedSection() {
  return (
    <SettingsSection
      title="Advanced"
      description="Switches for troubleshooting. Leave them on unless something looks wrong."
    >
      <FlagRow
        flag={generationRevealFlag}
        title="Show screens while they generate"
        description="Draw each screen on the canvas as the agent writes it. Turn off to see it only when it is done."
      />
      <FlagRow
        flag={streamingMutationsFlag}
        title="Apply agent edits as they stream"
        description="Show the agent's edits on the canvas while it works. Turn off to apply them when each step ends."
      />
      <FlagRow
        flag={rasterCacheFlag}
        title="Cache idle frames as images"
        description="Speeds up large documents. Turn off if frames look stale. Takes effect after reload."
      />
    </SettingsSection>
  );
}
