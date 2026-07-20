import { useStyleStore } from "@/store/styleStore";
import type { ToolHandler } from "../toolRegistry";
import { applyStyleToNodes } from "./applyStyleToNodes";

/** Bind one or more nodes' fill to a named fill style (from get_styles / set_styles). */
export const applyFillStyle: ToolHandler = async (args) => {
  const store = useStyleStore.getState();
  return applyStyleToNodes(
    args,
    "Fill style",
    (styleId) => store.fillStyles.find((s) => s.id === styleId),
    (nodeId, styleId) => store.applyFillStyleToNode(nodeId, styleId),
  );
};
