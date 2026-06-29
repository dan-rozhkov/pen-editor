import { EyeIcon, PlayIcon } from "@phosphor-icons/react";
import clsx from "clsx";
import { useEditorModeStore, orderedFrameIds } from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";

export function ModeToolbar() {
  const mode = useEditorModeStore((s) => s.mode);
  const enterView = useEditorModeStore((s) => s.enterView);
  const exitToEdit = useEditorModeStore((s) => s.exitToEdit);
  const enterPresent = useEditorModeStore((s) => s.enterPresent);
  const hasFrames = useSceneStore(
    (s) => orderedFrameIds(s.nodesById, s.rootIds).length > 0,
  );

  const isView = mode === "view";

  return (
    <div className="absolute top-4 right-4 z-50 flex items-center gap-1 p-1 bg-surface-panel border border-border-default rounded-xl shadow-md">
      <button
        data-testid="mode-view-toggle"
        onClick={() => (isView ? exitToEdit() : enterView())}
        title={isView ? "Exit view mode" : "View mode"}
        className={clsx(
          "flex items-center justify-center w-8 h-8 rounded-lg transition-colors",
          isView
            ? "bg-accent text-accent-foreground"
            : "text-text-muted hover:bg-surface-hover",
        )}
      >
        <EyeIcon size={16} />
      </button>
      <button
        data-testid="mode-present"
        onClick={() => enterPresent()}
        disabled={!hasFrames}
        title="Present"
        className="flex items-center justify-center w-8 h-8 rounded-lg text-text-muted hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <PlayIcon size={16} />
      </button>
    </div>
  );
}
