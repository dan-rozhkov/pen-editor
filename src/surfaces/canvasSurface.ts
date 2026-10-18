import type { Surface } from "@sideform/agent-harness/surface";
import { getEditorState } from "@/lib/tools/getEditorState";
import { batchGet } from "@/lib/tools/batchGet";
import { batchDesign } from "@/lib/tools/batchDesign";
import { snapshotLayout } from "@/lib/tools/snapshotLayout";
import { getVariables } from "@/lib/tools/getVariables";
import { getScreenshot } from "@/lib/tools/getScreenshot";
import { setVariables } from "@/lib/tools/setVariables";
import { getTextStyles } from "@/lib/tools/getTextStyles";
import { setTextStyles } from "@/lib/tools/setTextStyles";
import { applyTextStyle } from "@/lib/tools/applyTextStyle";
import { getStyles } from "@/lib/tools/getStyles";
import { setStyles } from "@/lib/tools/setStyles";
import { applyFillStyle } from "@/lib/tools/applyFillStyle";
import { applyEffectStyle } from "@/lib/tools/applyEffectStyle";
import { replaceAllMatchingProperties } from "@/lib/tools/replaceAllMatchingProperties";
import { searchAllUniqueProperties } from "@/lib/tools/searchAllUniqueProperties";
import { findEmptySpace } from "@/lib/tools/findEmptySpace";
import { renameLayers } from "@/lib/tools/renameLayers";
import { booleanOperation } from "@/lib/tools/booleanOperation";
import { getGuidelines, getStyleGuide, getStyleGuideTags } from "@/lib/tools/staticTools";
import { generateImage, generateFrameImage } from "@/lib/tools/generateImage";
import { setExportSettings } from "@/lib/tools/setExportSettings";
import { exportLayersSvg } from "@/lib/tools/exportLayersSvg";
import { readComments } from "@/lib/tools/readComments";
import { replyComment } from "@/lib/tools/replyComment";
import { resolveComment } from "@/lib/tools/resolveComment";
import { leaveComment } from "@/lib/tools/leaveComment";
import { createPlugin } from "@/lib/tools/plugins/createPlugin";
import { updatePlugin } from "@/lib/tools/plugins/updatePlugin";
import { listPlugins } from "@/lib/tools/plugins/listPlugins";
import { drawVector } from "@/lib/tools/drawVector";
import { generateVector } from "@/lib/tools/generateVector";
import { publishToShowcase } from "@/lib/tools/publishToShowcase";
import { readEmbedHtml } from "@/lib/tools/readEmbedHtml";
import { editEmbedHtml } from "@/lib/tools/editEmbedHtml";
import { removeBackground } from "@/lib/tools/removeBackground";
import { vectorizeImage } from "@/lib/tools/vectorizeImage";
import { readDesignRepo } from "@/lib/tools/readDesignRepo";
import { readRepoFiles } from "@/lib/tools/readRepoFiles";
import { attachLocalRepo } from "@/lib/tools/attachLocalRepo";
import { defineComponent, extractComponent, detachInstance, deleteComponent } from "@/lib/tools/components";
import { canvasMeta } from "./meta";
import { buildCanvasSurfaceContext } from "./canvasContext";
import type { ToolExecutionContext } from "./toolTypes";

/**
 * The design canvas (PixiJS scene graph): metadata (id, title) from ./meta,
 * the agent context builder and the tool map. Always mounted behind the UI,
 * so it has no View (see ./views). NOTE: the tool set per surface is metadata for now; every
 * tool of every surface is still sent to and allowed for the agent (see the
 * "Surfaces" section of CLAUDE.md).
 */
export const canvasSurface = {
  ...canvasMeta,
  buildContext: buildCanvasSurfaceContext,
  tools: {
  get_editor_state: getEditorState,
  batch_get: batchGet,
  snapshot_layout: snapshotLayout,
  get_screenshot: getScreenshot,
  get_variables: getVariables,
  batch_design: batchDesign,
  read_embed_html: readEmbedHtml,
  edit_embed_html: editEmbedHtml,
  // Embed HTML components (docs/superpowers/specs/
  // 2026-10-08-embed-html-components-design.md). Deliberately NOT in
  // mcpToolNames.ts: chat-path tools, not part of the MCP/WebMCP surfaces.
  // All four mutate, so they stay serialized (not in UNSERIALIZED_TOOL_NAMES).
  define_component: defineComponent,
  extract_component: extractComponent,
  detach_instance: detachInstance,
  delete_component: deleteComponent,
  set_variables: setVariables,
  get_text_styles: getTextStyles,
  set_text_styles: setTextStyles,
  apply_text_style: applyTextStyle,
  get_styles: getStyles,
  set_styles: setStyles,
  apply_fill_style: applyFillStyle,
  apply_effect_style: applyEffectStyle,
  replace_all_matching_properties: replaceAllMatchingProperties,
  find_empty_space_on_canvas: findEmptySpace,
  search_all_unique_properties: searchAllUniqueProperties,
  rename_layers: renameLayers,
  boolean_operation: booleanOperation,
  get_guidelines: getGuidelines,
  get_style_guide_tags: getStyleGuideTags,
  get_style_guide: getStyleGuide,
  generate_image: generateImage,
  generate_frame_image: generateFrameImage,
  set_export_settings: setExportSettings,
  export_layers_svg: exportLayersSvg,
  read_comments: readComments,
  reply_comment: replyComment,
  resolve_comment: resolveComment,
  leave_comment: leaveComment,
  create_plugin: createPlugin,
  update_plugin: updatePlugin,
  list_plugins: listPlugins,
  draw_vector: drawVector,
  generate_vector: generateVector,
  publish_to_showcase: publishToShowcase,
  remove_background: removeBackground,
  vectorize_image: vectorizeImage,
  read_design_repo: readDesignRepo,
  read_repo_files: readRepoFiles,
  attach_local_repo: attachLocalRepo,
  },
} satisfies Surface<ToolExecutionContext>;
