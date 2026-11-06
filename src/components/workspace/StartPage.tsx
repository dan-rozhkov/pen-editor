import "./workspace.css";

import { RecentList } from "@/components/workspace/RecentList";
import { removeRecentItem, useRecentItems } from "@/components/workspace/useRecentItems";
import type { RecentItem, RecentKind } from "@/lib/workspace/recent";

interface StartPageProps {
  onNew: (kind: RecentKind) => void;
  onOpen: (item: RecentItem) => void;
  /** Called before the item leaves its store, so the shell can close its tab without flushing. */
  onBeforeDelete: (item: RecentItem) => void;
}

const CARD =
  "ws-card flex flex-col overflow-hidden rounded-xl border border-border-default bg-surface-panel p-0 text-left text-text-muted cursor-pointer";
const CTA =
  "ws-cta mt-auto inline-flex h-7 items-center self-start rounded-control border border-border-default px-2.5 text-text-primary";

function Card({
  id,
  title,
  desc,
  cta,
  onClick,
  preview,
}: {
  id: string;
  title: string;
  desc: string;
  cta: string;
  onClick: () => void;
  preview: React.ReactNode;
}) {
  return (
    <button type="button" className={CARD} onClick={onClick} aria-labelledby={`${id}-cta`} aria-describedby={`${id}-desc`}>
      {preview}
      <span className="flex flex-1 flex-col gap-1 px-4 pt-3.5 pb-4">
        <span className="text-sm font-medium text-text-primary">{title}</span>
        <span id={`${id}-desc`} className="mb-2.5 leading-[18px]">
          {desc}
        </span>
        <span className={CTA}>
          <span id={`${id}-cta`}>{cta}</span>
        </span>
      </span>
    </button>
  );
}

/** The workspace start page: shown when no tab is active. Port of the desktop "empty start". */
export function StartPage({ onNew, onOpen, onBeforeDelete }: StartPageProps) {
  const { items, reload } = useRecentItems();

  const handleDelete = (item: RecentItem) => {
    onBeforeDelete(item);
    void removeRecentItem(item).then(reload);
  };

  return (
    <main className={`ws-start${items.length > 0 ? " has-recent" : ""} absolute inset-0 overflow-x-hidden overflow-y-auto`}>
      <div className="ws-start-inner box-border flex min-h-full flex-col items-center justify-center gap-5 p-6 [justify-content:safe_center]">
        <header className="flex flex-col items-center gap-1.5 text-center">
          <h1 className="m-0 text-[26px] leading-[1.2] font-semibold tracking-[-0.02em] text-balance text-text-primary">
            Where shall we start?
          </h1>
          <p className="m-0 text-text-muted">Canvas, document and workflow tabs open here.</p>
        </header>

        <div className="ws-cards w-full max-w-[840px] gap-3">
          <Card
            id="ws-canvas"
            title="Canvas"
            desc="Design screens with the agent on an open canvas."
            cta="New canvas tab"
            onClick={() => onNew("canvas")}
            preview={
              <span className="ws-preview ws-preview-canvas" aria-hidden="true">
                <span className="ws-frame ws-frame-a">
                  <span className="bar" />
                  <span className="ws-line" />
                  <span className="ws-line short" />
                </span>
                <span className="ws-frame ws-frame-b">
                  <span className="block" />
                </span>
                <span className="ws-frame ws-frame-c">
                  <span className="bar" />
                </span>
                <svg className="ws-cursor" viewBox="-2.4 -2.6 24.2 24.4">
                  <polygon className="rim" points="2.2,1.6 17.6,8.5 10.8,12.4 6.2,17.7" strokeWidth="7.8" strokeLinejoin="round" strokeLinecap="round" />
                  <polygon className="body" points="2.2,1.6 17.6,8.5 10.8,12.4 6.2,17.7" strokeWidth="5.4" strokeLinejoin="round" strokeLinecap="round" />
                </svg>
              </span>
            }
          />
          <Card
            id="ws-doc"
            title="Document"
            desc="Write notes, briefs and specs in Markdown."
            cta="New document"
            onClick={() => onNew("doc")}
            preview={
              <span className="ws-preview" aria-hidden="true">
                <span className="ws-sheet ws-sheet-back" />
                <span className="ws-sheet">
                  <span className="heading" />
                  <span className="ws-line" />
                  <span className="ws-line" />
                  <span className="ws-line short" />
                  <span className="ws-check">
                    <span className="box" />
                    <span className="ws-line" />
                  </span>
                </span>
              </span>
            }
          />
          <Card
            id="ws-workflow"
            title="Workflow"
            desc="Keep a titled list of steps for the agent to run."
            cta="New workflow"
            onClick={() => onNew("workflow")}
            preview={
              <span className="ws-preview" aria-hidden="true">
                <span className="ws-steps">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className="ws-step">
                      <span className="num" />
                      <span className={i % 2 ? "ws-line short" : "ws-line"} />
                    </span>
                  ))}
                </span>
              </span>
            }
          />
        </div>

        <RecentList items={items} onOpen={onOpen} onDelete={handleDelete} />
      </div>
    </main>
  );
}
