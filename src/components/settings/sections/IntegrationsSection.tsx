import { Button } from "@/components/ui/button";
import { connectMobbinWithToast } from "@/lib/connectMobbin";
import { useMobbinAuthStore } from "@/store/mobbinAuthStore";

import { SettingsGroup, SettingsSection } from "../SettingsSection";

const STATUS_TEXT = {
  connected: "Connected. The agent can search Mobbin references.",
  connecting: "Waiting for Mobbin to finish sign-in…",
  disconnected: "Not connected. Connect to let the agent search Mobbin references.",
} as const;

export function IntegrationsSection() {
  const status = useMobbinAuthStore((s) => s.status);
  const error = useMobbinAuthStore((s) => s.error);
  return (
    <SettingsSection title="Integrations">
      <SettingsGroup inline title="Mobbin" description={error ?? STATUS_TEXT[status]}>
        <Button
          variant="outline"
          disabled={status === "connecting"}
          onClick={() => (status === "connected" ? useMobbinAuthStore.getState().disconnect() : void connectMobbinWithToast())}
        >
          {status === "connected" ? "Disconnect" : status === "connecting" ? "Connecting…" : "Connect"}
        </Button>
      </SettingsGroup>
    </SettingsSection>
  );
}
