import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  UploadSimpleIcon,
  PuzzlePieceIcon,
  DotsThreeVertical,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { usePluginStore } from "@/store/pluginStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useReadOnly } from "@/hooks/useReadOnly";
import { runPlugin } from "@/lib/plugins/pluginHost";
import { exportPluginToFile, parsePluginImport } from "@/lib/plugins/pluginTransfer";
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
import { IconButton } from "@/components/ui/IconButton";
import { EditableText } from "@/components/ui/EditableText";
import { Input } from "@/components/ui/input";
import { PanelEmptyState } from "@/components/PanelEmptyState";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Left-sidebar panel for installed plugins (reachable via the Toolbox rail
 * icon, or the "Manage plugins…" command palette entry which navigates
 * here). Lists installed plugins with run/rename/delete/export actions,
 * plus JSON import.
 */
export function PluginsPanel() {
  const plugins = usePluginStore((s) => s.plugins);
  const rename = usePluginStore((s) => s.rename);
  const remove = usePluginStore((s) => s.remove);
  const install = usePluginStore((s) => s.install);
  // Dev (inspect) mode is read-only, mirroring the `mutatesScene` guard that
  // hides per-plugin Run commands from the command palette (pluginCommands.ts)
  // — a plugin can call scene-mutating tools, so Run must not be reachable
  // from here either while dev mode is active. The sidebar (and this panel
  // with it) is also visible in VIEW mode, which is read-only via
  // ReadOnlyProvider — Run must be disabled there too.
  const isDevMode = useDevModeStore((s) => s.active);
  const isReadOnly = useReadOnly();

  const [deletingPluginId, setDeletingPluginId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const deletingPlugin =
    deletingPluginId ? (plugins.find((p) => p.id === deletingPluginId) ?? null) : null;
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredPlugins = normalizedQuery
    ? plugins.filter((plugin) =>
        `${plugin.name} ${plugin.description}`.toLocaleLowerCase().includes(normalizedQuery),
      )
    : plugins;

  async function handleImportFile(file: File): Promise<void> {
    const result = parsePluginImport(await file.text());
    if (!result.ok) {
      toast(
        result.reason === "invalid-json"
          ? "That file isn't valid JSON."
          : "That file doesn't look like a plugin export.",
      );
      return;
    }
    const installed = await install(result.input);
    toast(`Imported "${installed.name}".`);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[49px] shrink-0 items-center gap-2 border-b border-border-default px-4 py-3">
        <span className="flex-1 text-sm font-medium text-text-primary">Plugins</span>
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
        <IconButton
          tooltip="Import plugin"
          variant="ghost"
          size="icon-sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadSimpleIcon size={16} />
        </IconButton>
      </div>
      <div className="relative px-3 pt-3 pb-2">
        <MagnifyingGlassIcon
          aria-hidden
          size={14}
          className="pointer-events-none absolute top-[26px] left-5 -translate-y-1/2 text-text-muted"
        />
        <Input
          aria-label="Search plugins"
          placeholder="Search plugins…"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="h-7 pl-7"
        />
      </div>

      <div className="flex-1 flex flex-col gap-2 overflow-y-auto px-2">
        {plugins.length === 0 && (
          <PanelEmptyState icon={null}>No plugins installed yet.</PanelEmptyState>
        )}
        {plugins.length > 0 && filteredPlugins.length === 0 && (
          <PanelEmptyState icon={null}>No plugins found.</PanelEmptyState>
        )}
        {filteredPlugins.map((plugin) => (
          <div
            key={plugin.id}
            data-testid={`plugin-card-${plugin.id}`}
            title={
              isDevMode
                ? "Run is disabled in Dev Mode"
                : isReadOnly
                  ? "Run is disabled in view mode"
                  : "Run plugin"
            }
            className={`group flex gap-3 rounded-lg px-2 py-3 ${
              isDevMode || isReadOnly
                ? "cursor-default"
                : "cursor-pointer hover:bg-secondary/60"
            }`}
            onClick={() => {
              if (!isDevMode && !isReadOnly) void runPlugin(plugin);
            }}
          >
            <div
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-text-muted"
            >
              <PuzzlePieceIcon size={20} weight="light" />
            </div>
            <div className="relative min-w-0 flex flex-1 flex-col pr-7">
              <div className="min-w-0" onClick={(event) => event.stopPropagation()}>
                <EditableText
                  value={plugin.name}
                  onCommit={(name) => void rename(plugin.id, name)}
                  className="text-xs font-medium text-text-primary truncate"
                />
              </div>
              <p className="truncate text-xs leading-4 text-text-muted">{plugin.description}</p>
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <IconButton
                        tooltip="Plugin options"
                        size="icon-sm"
                        variant="ghost"
                        className="text-text-muted hover:text-text-primary"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <DotsThreeVertical size={16} weight="bold" />
                      </IconButton>
                    }
                  />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => exportPluginToFile(plugin)}>
                      Export
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDeletingPluginId(plugin.id)}>
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        ))}
      </div>

      <AlertDialog open={deletingPlugin != null} onOpenChange={(next) => !next && setDeletingPluginId(null)}>
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
                setDeletingPluginId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
