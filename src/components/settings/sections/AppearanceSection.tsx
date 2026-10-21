import { RadioGroup } from "@base-ui/react/radio-group";

import { useUIThemeStore } from "@/store/uiThemeStore";
import type { UITheme } from "@/lib/uiTheme";

import { SettingsGroup, SettingsSection } from "../SettingsSection";
import { ThemePreviewCard } from "../ThemePreviewCard";

export function AppearanceSection() {
  const uiTheme = useUIThemeStore((s) => s.uiTheme);
  return (
    <SettingsSection title="Appearance">
      <SettingsGroup title="Theme" description="Applies to the editor and every open window.">
        <RadioGroup
          aria-label="Theme"
          value={uiTheme}
          onValueChange={(next) => useUIThemeStore.getState().setUITheme(next as UITheme, { source: "user" })}
          className="grid grid-cols-2 gap-4"
        >
          <ThemePreviewCard theme="light" label="Light" />
          <ThemePreviewCard theme="dark" label="Dark" />
        </RadioGroup>
      </SettingsGroup>
    </SettingsSection>
  );
}
