import { getEditorState } from "./tools/getEditorState";
import { batchGet } from "./tools/batchGet";
import { batchDesign } from "./tools/batchDesign";
import { snapshotLayout } from "./tools/snapshotLayout";
import { getVariables } from "./tools/getVariables";
import { getScreenshot } from "./tools/getScreenshot";
import { setVariables } from "./tools/setVariables";
import { getTextStyles } from "./tools/getTextStyles";
import { setTextStyles } from "./tools/setTextStyles";
import { applyTextStyle } from "./tools/applyTextStyle";
import { replaceAllMatchingProperties } from "./tools/replaceAllMatchingProperties";
import { searchAllUniqueProperties } from "./tools/searchAllUniqueProperties";
import { findEmptySpace } from "./tools/findEmptySpace";
import { renameLayers } from "./tools/renameLayers";
import { booleanOperation } from "./tools/booleanOperation";
import { getGuidelines, getStyleGuide, getStyleGuideTags } from "./tools/staticTools";
import { generateImage, generateFrameImage } from "./tools/generateImage";
export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<string>;

export const toolHandlers: Record<string, ToolHandler> = {
  get_editor_state: getEditorState,
  batch_get: batchGet,
  snapshot_layout: snapshotLayout,
  get_screenshot: getScreenshot,
  get_variables: getVariables,
  batch_design: batchDesign,
  set_variables: setVariables,
  get_text_styles: getTextStyles,
  set_text_styles: setTextStyles,
  apply_text_style: applyTextStyle,
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
};
