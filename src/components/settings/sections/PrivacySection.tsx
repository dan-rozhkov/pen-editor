import { lazy, Suspense, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { analyticsFlag, isAnalyticsConfigured } from "@/lib/analytics";
import { downloadUserDataExport } from "@/lib/exportUserData";
import { useAuthConfig } from "@/lib/auth/authConfig";

import { SettingsGroup, SettingsSection } from "../SettingsSection";

const DeleteAccountGroup = lazy(() => import("./DeleteAccountGroup"));

export function PrivacySection() {
  const analyticsOn = useSyncExternalStore(analyticsFlag.subscribe, analyticsFlag.get, () => true);
  const authConfig = useAuthConfig();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);

  async function runExport() {
    setExporting(true);
    setExportError(false);
    try {
      await downloadUserDataExport();
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <SettingsSection title="Data & privacy">
      <SettingsGroup
        inline
        title="Usage analytics"
        description={
          isAnalyticsConfigured()
            ? "Share anonymous usage counts to help improve the product. No prompts or document content."
            : "Analytics is not enabled in this build."
        }
      >
        {isAnalyticsConfigured() && (
          <Switch aria-label="Usage analytics" checked={analyticsOn} onCheckedChange={analyticsFlag.set} />
        )}
      </SettingsGroup>
      <SettingsGroup
        inline
        title="Export my data"
        description={
          exportError
            ? "Could not create the file. Try again."
            : "Download docs, workflows, skills and agent memory as one JSON file."
        }
      >
        <Button variant="outline" disabled={exporting} onClick={() => void runExport()}>
          {exporting ? "Exporting…" : "Export"}
        </Button>
      </SettingsGroup>
      {authConfig?.enabled && (
        <Suspense fallback={null}>
          <DeleteAccountGroup />
        </Suspense>
      )}
    </SettingsSection>
  );
}
