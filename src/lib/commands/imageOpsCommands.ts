// Palette entries for the two image operations (remove background /
// vectorize) that also surface as toolbar buttons in ImageOpsTools.tsx.
// Deliberately NOT sourced from ALL_TOOLS/getToolCommands() — these are
// one-shot actions on the current selection, not draw-tool toggles, and
// toolDefinitions.ts's tool list feeds the toolbar 1:1 (see its own
// invariant note). This is its own small source, like getPluginCommands().
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { canRemoveBackground, canVectorize } from "@/lib/imageOps/capabilities";
import { resolveImageOpsTargetNodeId } from "./imageOpsTarget";
import { runRemoveBackground, runVectorize } from "./imageOpsActions";
import type { PaletteCommand } from "./types";
import { MagicWandIcon, BezierCurveIcon } from "@phosphor-icons/react";

// getCommands() rebuilds this list fresh every time the palette opens, so
// reading selection/scene state directly here (rather than via a hook) is
// safe and matches getPluginCommands()'s pattern.
function getCurrentTargetNodeId(): string | null {
  const { nodesById } = useSceneStore.getState();
  const { selectedIds } = useSelectionStore.getState();
  return resolveImageOpsTargetNodeId(nodesById, selectedIds);
}

/**
 * "Remove background" / "Vectorize" palette commands. Each is only listed
 * at all when its backend capability flag is on — mirrors ImageOpsTools.tsx,
 * which hides the corresponding button under the same condition. Both are
 * flagged `mutatesScene`, same as plugin Run commands: the palette itself
 * only mounts in "edit" mode (App.tsx), and `mutatesScene` additionally
 * hides them while Dev (inspect) mode is active — between the two, no extra
 * read-only check is needed here.
 *
 * There is no per-command "selection changed since the palette opened"
 * guard: the target node id is resolved once when the list is built and
 * `run()` acts on that id. If the selection changed in the (very short)
 * window the palette was open, the underlying imageOps call still fails
 * safely (node-not-found errors) and reports via the same error toast.
 */
export function getImageOpsCommands(): PaletteCommand[] {
  const targetNodeId = getCurrentTargetNodeId();
  if (!targetNodeId) return [];

  const commands: PaletteCommand[] = [];

  if (canRemoveBackground()) {
    commands.push({
      id: "image-ops-remove-background",
      label: "Remove background",
      group: "Tools",
      icon: MagicWandIcon,
      keywords: ["image", "cutout", "background removal"],
      mutatesScene: true,
      run: () => {
        runRemoveBackground(targetNodeId).catch(() => {
          // Already reported via toast.error inside runRemoveBackground.
        });
      },
    });
  }

  if (canVectorize()) {
    commands.push({
      id: "image-ops-vectorize",
      label: "Vectorize",
      group: "Tools",
      icon: BezierCurveIcon,
      keywords: ["image", "trace", "svg", "vector layers"],
      mutatesScene: true,
      run: () => {
        runVectorize(targetNodeId).catch(() => {
          // Already reported via toast.error inside runVectorize.
        });
      },
    });
  }

  return commands;
}
