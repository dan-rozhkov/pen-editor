/**
 * The scene-derived part of the per-turn `canvasContext` (everything except
 * the chat-side `likedReferences`). Shared by the local chat path
 * (`buildCanvasContext` in useDesignChat.ts) and the canvas link host, which
 * answers the agent panel's `context-request` with
 * `JSON.stringify(buildSceneContext({ model }))`. Key order is part of the
 * contract: the string is part of the prompt-cache prefix.
 */
import { canSendImages } from "@/lib/chatModels";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import { useRepoContextStore } from "@/store/repoContextStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";
import { getVariableCssName } from "@/types/variable";

export function buildSceneContext({ model }: { model: string }): Record<string, unknown> {
  const { selectedIds } = useSelectionStore.getState();
  const { rootIds, nodesById } = useSceneStore.getState();
  const { activeTheme } = useThemeStore.getState();
  const { variables } = useVariableStore.getState();

  const roots = rootIds.map((id) => {
    const n = nodesById[id];
    return n ? { id: n.id, type: n.type, name: n.name } : { id };
  });

  const selectedNodes = selectedIds.map((id) => {
    const n = nodesById[id];
    if (!n) return { id };
    const rec = n as unknown as Record<string, unknown>;
    return {
      id: n.id,
      type: n.type,
      name: n.name,
      x: rec.x,
      y: rec.y,
      width: rec.width,
      height: rec.height,
    };
  });

  // No selected node is ever auto-screenshotted (see useSelectionContext.ts)
  // to save tokens — only its id goes out above in
  // selectedIds/selectedNodes. Tell the model that explicitly, but only when
  // it's actually relevant: a constant string, not derived from selection
  // data, so it doesn't churn the request when nothing in the selection
  // would trigger it.
  const hasSelection = selectedIds.some((id) => nodesById[id]);
  // get_screenshot may not be in the model's toolset at all (the backend
  // drops it for a vision-less model with no VISION_MODEL configured — see
  // the root CLAUDE.md's "Agent vision" section) — canSendImages() mirrors
  // that exact condition on the frontend. Pointing the model at a tool it
  // doesn't have would just waste a turn.
  const selectionHint = hasSelection && canSendImages(model)
    ? "Screenshots of the selected nodes are intentionally NOT attached. If you need to see one, call get_screenshot with its node id."
    : null;

  // A repo pushed in over WebMCP (attach_local_repo) otherwise silently
  // changes what read_design_repo/read_repo_files answer with no signal to
  // the model that it should reach for them — this is the only thing that
  // tells it a local repo exists at all. Name + counts only, never file
  // contents or the tree itself: this is rebuilt every request (including
  // every tool-loop auto-continuation) and appended as a trailing user
  // message, so it must stay tiny and it must never carry anything that
  // would belong in the system prompt instead (see the root CLAUDE.md's
  // prompt-cache invariants). Omitted entirely when nothing is attached, so
  // a fresh session's canvasContext is byte-identical to before this
  // existed.
  const repoContextState = useRepoContextStore.getState();
  const localRepo = repoContextState.isAttached()
    ? {
        name: repoContextState.name,
        fileCount: repoContextState.filesByPath.size,
        treeSize: repoContextState.tree.length,
      }
    : null;

  // Element the user pointed at inside an embed via the element picker
  // (auto-started whenever an embed is the sole selection — see
  // useEmbedPickerLifecycle). Only forwarded while the
  // embed it belongs to still exists in the scene — a stale embedId (node
  // deleted) is otherwise cleared by useEmbedPickerLifecycle, but this is a
  // last-line guard against sending a dangling reference to the agent.
  const pickerSelection = useEmbedPickerStore.getState().selection;
  const selectedEmbedElement =
    pickerSelection && nodesById[pickerSelection.embedId]
      ? {
          ...pickerSelection,
          hint:
            `The user pointed at this element inside embed ${pickerSelection.embedId}. ` +
            "Locate it with read_embed_html (mode 'grep') to get a byte-exact anchor before " +
            "calling edit_embed_html — this outerHtml comes from the rendered DOM and may " +
            "differ from the stored source.",
        }
      : undefined;

  return {
    roots,
    selectedIds,
    selectedNodes,
    activeTheme,
    variables: variables.map((v) => ({
      name: v.name,
      type: v.type,
      value: v.value,
      themeValues: v.themeValues,
      // The name to reference from CSS/embed HTML (`var(--x)`) — `name`
      // itself may be a free-form label like "Color 1" that is not valid
      // CSS. Appended last, not inserted earlier, so this payload's shape
      // for existing fields stays byte-identical and doesn't invalidate
      // the prompt cache for callers that only read the earlier keys.
      cssName: getVariableCssName(v),
    })),
    ...(selectionHint ? { selectionHint } : {}),
    ...(selectedEmbedElement ? { selectedEmbedElement } : {}),
    ...(localRepo ? { localRepo } : {}),
  };
}
