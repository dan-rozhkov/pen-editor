import { useState } from "react";
import type { UIMessage } from "ai";
import { FilmStripIcon, FileTextIcon, ListBulletsIcon, PaintBrushIcon, type Icon } from "@/components/icons";
import { IconButton } from "@/components/ui/IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getAgentPanelCanvasBridge } from "@/lib/agentPanel";
import { getPanelClient } from "@/lib/canvasLink/panelRuntime";
import { collectChatArtifacts, openChatArtifact, type ChatArtifact, type ChatArtifactKind } from "@/lib/chatArtifacts";
import { getDoc } from "@/lib/docs/docStore";
import { traceOpener } from "@/lib/traceOpener";

const SECTION_LIMIT = 5;

const SECTIONS: { kind: ChatArtifactKind; label: string }[] = [
  { kind: "doc", label: "Documents" },
  { kind: "canvas", label: "Canvases" },
  { kind: "trace", label: "Traces" },
];

function iconFor(kind: ChatArtifactKind): Icon {
  if (kind === "doc") return FileTextIcon;
  if (kind === "canvas") return PaintBrushIcon;
  return FilmStripIcon;
}

interface Snapshot {
  items: ChatArtifact[];
  /** Live canvas tab titles by tabId; null = not listed (no bridge, or the listing failed). */
  liveTabs: Map<number, string> | null;
}

function snapshot(messages: UIMessage[], hasCanvasBridge: boolean): Snapshot {
  const items = collectChatArtifacts(messages, {
    docTitle: (id) => getDoc(id)?.title,
    tabForCall: (callId) => getPanelClient()?.tabForCall(callId),
  }).filter((a) => {
    if (a.kind === "canvas") return hasCanvasBridge;
    if (a.kind === "trace") return a.source !== undefined && traceOpener({ id: a.id, source: a.source }) !== undefined;
    return true;
  });
  return { items, liveTabs: null };
}

/** Header button + popover listing the documents, canvases and traces a chat touched. */
export function ConversationFilesPopover({ getMessages }: { getMessages: () => UIMessage[] }) {
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState<Snapshot>({ items: [], liveTabs: null });
  const [expanded, setExpanded] = useState<ReadonlySet<ChatArtifactKind>>(new Set());

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setExpanded(new Set());
    const bridge = getAgentPanelCanvasBridge();
    let fresh: Snapshot;
    try {
      fresh = snapshot(getMessages(), bridge !== undefined);
    } catch {
      fresh = { items: [], liveTabs: null };
    }
    setSnap(fresh);
    if (bridge && fresh.items.some((a) => a.kind === "canvas")) {
      void bridge
        .listTabs()
        .then((tabs) => {
          const live = new Map(tabs.map((t) => [t.tabId, t.title] as const));
          setSnap((cur) => (cur.items === fresh.items ? { ...cur, liveTabs: live } : cur));
        })
        .catch(() => undefined);
    }
  };

  const select = (artifact: ChatArtifact) => {
    openChatArtifact(artifact);
    setOpen(false);
  };

  const sections = SECTIONS.map((s) => ({ ...s, items: snap.items.filter((a) => a.kind === s.kind) })).filter(
    (s) => s.items.length > 0,
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <IconButton
            data-testid="conversation-files-trigger"
            variant="ghost"
            size="icon"
            tooltip="Conversation files"
            aria-label="Conversation files"
          >
            <ListBulletsIcon className="size-4" weight="light" />
          </IconButton>
        }
      />
      <PopoverContent side="bottom" align="end" sideOffset={4} className="w-72 gap-3 rounded-xl p-3" data-testid="conversation-files-popover">
        {sections.length === 0 ? (
          <p className="px-1 py-1 text-[13px] text-text-muted">Documents, canvases and traces from this chat appear here.</p>
        ) : (
          sections.map((section) => {
            const isExpanded = expanded.has(section.kind);
            const shown = isExpanded ? section.items : section.items.slice(0, SECTION_LIMIT);
            const Glyph = iconFor(section.kind);
            return (
              <section key={section.kind} className="flex flex-col gap-0.5">
                <h3 className="px-2 pb-1 text-[13px] text-text-muted">{section.label}</h3>
                {shown.map((a) => {
                  const liveTitle = a.tabId !== undefined ? snap.liveTabs?.get(a.tabId) : undefined;
                  const closed = a.kind === "canvas" && snap.liveTabs !== null && liveTitle === undefined;
                  const deleted = a.missing === true;
                  return (
                    <button
                      key={`${a.kind}:${a.id}`}
                      type="button"
                      disabled={closed || deleted}
                      onClick={() => select(a)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-text-primary outline-none hover:bg-secondary focus-visible:ring-[2px] focus-visible:ring-ring disabled:pointer-events-none disabled:text-text-muted"
                    >
                      <Glyph size={15} className="shrink-0 text-text-muted" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{liveTitle ?? a.title}</span>
                      {closed && <span className="shrink-0 text-[13px] text-text-muted">closed</span>}
                      {deleted && <span className="shrink-0 text-[13px] text-text-muted">deleted</span>}
                    </button>
                  );
                })}
                {!isExpanded && section.items.length > SECTION_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setExpanded((cur) => new Set(cur).add(section.kind))}
                    className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-text-muted outline-none hover:bg-secondary focus-visible:ring-[2px] focus-visible:ring-ring"
                  >
                    Show all ({section.items.length})
                  </button>
                )}
              </section>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}
