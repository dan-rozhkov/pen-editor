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
        className="grid grid-cols-3 gap-4"
      >
        {state.options.map((o) => (
          <Radio.Root
            key={o.id}
            value={o.id}
            aria-label={o.label}
            className="group flex w-full cursor-default flex-col items-center gap-2 text-left outline-none"
          >
            <span className="relative block rounded-2xl group-data-checked:ring-2 group-data-checked:ring-accent-primary group-focus-visible:ring-2 group-focus-visible:ring-accent-primary">
              <img src={o.preview} alt="" className="block size-24" draggable={false} />
              <Radio.Indicator className="absolute right-1.5 bottom-1.5 flex size-4 items-center justify-center rounded-full bg-accent-primary text-white">
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
