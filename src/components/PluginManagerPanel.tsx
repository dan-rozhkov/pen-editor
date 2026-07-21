import { useRef, useState } from "react";
import { toast } from "sonner";
import { usePluginManagerStore } from "@/store/pluginManagerStore";
import { usePluginStore, type PluginInstallInput } from "@/store/pluginStore";
import { runPlugin } from "@/lib/plugins/pluginHost";
import type { PenPlugin } from "@/lib/plugins/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { EditableText } from "@/components/ui/EditableText";
import { Textarea } from "@/components/ui/textarea";
import { PanelEmptyState } from "@/components/PanelEmptyState";
import { PlayIcon, TrashIcon, CodeIcon, DownloadSimpleIcon, UploadSimpleIcon } from "@phosphor-icons/react";

/** Shape we accept on import: the required `PenPlugin` fields, everything
 * else (id/timestamps/source) is optional — `id` (if present and not
 * colliding with an installed plugin) round-trips our own exports back to
 * the same record; `pluginStore.install` assigns a fresh id otherwise. */
function isImportablePlugin(
  value: unknown,
): value is Partial<PenPlugin> & Pick<PenPlugin, "name" | "description" | "code"> {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === "string" && typeof v.description === "string" && typeof v.code === "string";
}

function downloadPluginJson(plugin: PenPlugin): void {
  const blob = new Blob([JSON.stringify(plugin, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${plugin.name.replace(/[^a-z0-9-_]+/gi, "-") || "plugin"}.json`;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Manager panel for installed plugins (opened via the "Manage plugins…"
 * command palette entry, `pluginManagerStore`). Lists installed plugins with
 * run/rename/view-code/delete/export actions, plus JSON import.
 */
export function PluginManagerPanel() {
  const open = usePluginManagerStore((s) => s.open);
  const setOpen = usePluginManagerStore((s) => s.setOpen);
  const plugins = usePluginStore((s) => s.plugins);
  const rename = usePluginStore((s) => s.rename);
  const remove = usePluginStore((s) => s.remove);
  const install = usePluginStore((s) => s.install);

  const [viewingCodeId, setViewingCodeId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const viewingPlugin = plugins.find((p) => p.id === viewingCodeId) ?? null;
  const deletingPlugin = plugins.find((p) => p.id === deletingId) ?? null;

  async function handleImportFile(file: File): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      toast("That file isn't valid JSON.");
      return;
    }
    if (!isImportablePlugin(parsed)) {
      toast("That file doesn't look like a plugin export.");
      return;
    }
    const input: PluginInstallInput = {
      name: parsed.name,
      description: parsed.description,
      code: parsed.code,
      icon: parsed.icon,
      ui: parsed.ui,
      source: "imported",
      // `install` dedupes: a colliding id (or none) is replaced with a fresh
      // one, an id from our own export round-trips back to the same record.
      id: parsed.id,
    };
    const installed = await install(input);
    toast(`Imported "${installed.name}".`);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>Plugins</DialogTitle>
            <DialogDescription>
              Installed generative plugins. Run one from here or from the command palette.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
            {plugins.length === 0 && (
              <PanelEmptyState icon={null}>No plugins installed yet.</PanelEmptyState>
            )}
            {plugins.map((plugin) => (
              <div
                key={plugin.id}
                className="flex items-start gap-2 rounded-md bg-surface-panel px-2 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {plugin.icon && <span aria-hidden>{plugin.icon}</span>}
                    <EditableText
                      value={plugin.name}
                      onCommit={(name) => void rename(plugin.id, name)}
                      className="text-xs font-medium text-text-primary truncate"
                    />
                  </div>
                  <p className="text-xs text-text-muted truncate px-2">{plugin.description}</p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <IconButton
                    tooltip="Run"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => runPlugin(plugin)}
                  >
                    <PlayIcon />
                  </IconButton>
                  <IconButton
                    tooltip="View code"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => setViewingCodeId(plugin.id)}
                  >
                    <CodeIcon />
                  </IconButton>
                  <IconButton
                    tooltip="Export"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => downloadPluginJson(plugin)}
                  >
                    <DownloadSimpleIcon />
                  </IconButton>
                  <IconButton
                    tooltip="Delete"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => setDeletingId(plugin.id)}
                  >
                    <TrashIcon />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleImportFile(file);
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <UploadSimpleIcon data-icon="inline-start" />
              Import…
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={viewingPlugin != null} onOpenChange={(next) => !next && setViewingCodeId(null)}>
        <DialogContent className="sm:max-w-lg" showCloseButton>
          <DialogHeader>
            <DialogTitle>{viewingPlugin?.name}</DialogTitle>
            <DialogDescription>Read-only — code lives in this plugin's stored record.</DialogDescription>
          </DialogHeader>
          <Textarea value={viewingPlugin?.code ?? ""} readOnly className="min-h-64 font-mono text-xs" />
        </DialogContent>
      </Dialog>

      <AlertDialog open={deletingPlugin != null} onOpenChange={(next) => !next && setDeletingId(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deletingPlugin?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes it from the plugin library and the command palette. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deletingPlugin) void remove(deletingPlugin.id);
                setDeletingId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
