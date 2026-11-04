import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { CheckIcon } from "@/components/icons";
import type { DesktopAppIconState } from "@/lib/desktopBridge";

import { SettingsGroup } from "./SettingsSection";

type Result = DesktopAppIconState | { error: string };

function usable(result: Result): DesktopAppIconState {
  if ("error" in result) throw new Error(result.error);
  return {
    selected: result.selected,
    options: result.options.filter((o) => typeof o.preview === "string" && o.preview.startsWith("data:image/png")),
  };
}

/** Dock icon picker. Desktop shell only: renders nothing on the web, on an older shell, while loading or on an error. */
export function AppIconGroup() {
  const api = typeof window === "undefined" ? undefined : window.penDesktop?.appIcon;
  const [state, setState] = useState<DesktopAppIconState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    api
      .get()
      .then((r) => {
        if (alive) setState(usable(r));
      })
      .catch((err: unknown) => {
        console.warn("App icon settings are unavailable.", err);
      });
    return () => {
      alive = false;
    };
  }, [api]);

  if (!api || !state || state.options.length === 0) return null;

  const choose = (id: string) => {
    if (busy || id === state.selected) return;
    setBusy(true);
    api
      .set(id)
      .then((r) => setState(usable(r)))
      .catch(() => toast.error("Could not change the app icon."))
      .finally(() => setBusy(false));
  };

  return (
    <SettingsGroup
      title="App icon"
      description="Shows in the Dock while Sideform is open. macOS shows the white icon when the app is closed."
    >
      <RadioGroup
        aria-label="App icon"
        value={state.selected}
        onValueChange={(next) => choose(next as string)}
        disabled={busy}
        className="flex flex-wrap gap-3"
      >
        {state.options.map((o) => (
          <Radio.Root
            key={o.id}
            value={o.id}
            aria-label={o.label}
            className="group flex w-14 cursor-default flex-col items-start gap-1.5 text-left outline-none"
          >
            <span className="relative block size-14 rounded-[13px] ring-1 ring-border-default group-data-checked:ring-2 group-data-checked:ring-accent-primary group-focus-visible:ring-2 group-focus-visible:ring-accent-primary">
              {/* The PNG keeps macOS's transparent margin: the scale crops it, so the tile starts at the left edge. */}
              <span className="block size-full overflow-hidden rounded-[13px]">
                <img src={o.preview} alt="" className="block size-full scale-[1.243]" draggable={false} />
              </span>
              <Radio.Indicator className="absolute right-1 bottom-1 flex size-4 items-center justify-center rounded-full bg-accent-primary text-white">
                <CheckIcon className="size-2.5" />
              </Radio.Indicator>
            </span>
            <span className="text-xs font-medium text-text-primary">{o.label}</span>
          </Radio.Root>
        ))}
      </RadioGroup>
    </SettingsGroup>
  );
}
