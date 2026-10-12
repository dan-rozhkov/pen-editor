import { useId } from "react";
import { GearSixIcon } from "@phosphor-icons/react";
import { IconButton } from "@/components/ui/IconButton";
import { Switch } from "@/components/ui/switch";
import { useBrowserAgentAvailable } from "@/lib/cloudBrowserConfig";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBrowserAgentSettingsStore } from "@/store/browserAgentSettingsStore";

interface SwitchRowProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

function SwitchRow({ label, hint, checked, onChange }: SwitchRowProps) {
  const labelId = useId();
  const hintId = useId();
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div id={labelId} className="text-xs font-medium text-text-primary">
          {label}
        </div>
        <p id={hintId} className="mt-0.5 text-xs text-text-muted">
          {hint}
        </p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-labelledby={labelId}
        aria-describedby={hintId}
        className="mt-0.5"
      />
    </div>
  );
}

/** Composer button opening the browser-agent permission switches. */
export function BrowserAgentSettings() {
  const available = useBrowserAgentAvailable();
  const allowPasswordEntry = useBrowserAgentSettingsStore((s) => s.allowPasswordEntry);
  const confirmIrreversible = useBrowserAgentSettingsStore((s) => s.confirmIrreversible);
  const setAllowPasswordEntry = useBrowserAgentSettingsStore((s) => s.setAllowPasswordEntry);
  const setConfirmIrreversible = useBrowserAgentSettingsStore((s) => s.setConfirmIrreversible);

  if (!available) return null;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <IconButton
            type="button"
            variant="ghost"
            size="icon"
            tooltip="Browser agent settings"
            aria-label="Browser agent settings"
            className="size-[30px] text-text-muted hover:bg-secondary"
          >
            <GearSixIcon size={18} weight="light" />
          </IconButton>
        }
      />
      <PopoverContent side="top" align="end" className="w-[280px] gap-3">
        <SwitchRow
          label="Allow password entry"
          hint="The agent may type a password only if you write it in the chat. The password is then sent to the agent's AI models and stays in the chat history."
          checked={allowPasswordEntry}
          onChange={setAllowPasswordEntry}
        />
        <SwitchRow
          label="Confirm irreversible actions"
          hint="Before it clicks a button that reserves, books, buys, pays or sends an application, the agent stops and asks you."
          checked={confirmIrreversible}
          onChange={setConfirmIrreversible}
        />
      </PopoverContent>
    </Popover>
  );
}
