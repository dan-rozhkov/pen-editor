import {
  BookOpenIcon,
  BoundingBoxIcon,
  BrainIcon,
  CameraIcon,
  CrosshairIcon,
  DeviceMobileIcon,
  FlowArrowIcon,
  type Icon,
  LightbulbIcon,
  MagnifyingGlassIcon,
  PaletteIcon,
  PencilSimpleIcon,
  RulerIcon,
  SlidersHorizontalIcon,
  SquaresFourIcon,
  SwapIcon,
  SwatchesIcon,
  TagIcon,
  TextAaIcon,
  QuestionIcon,
  WrenchIcon,
} from "@phosphor-icons/react";

// Icon per tool, shown before the label in ToolCallIndicator. Keys mirror
// `toolDisplayNames` — `toolIcons.test.ts` fails if the two drift, so a new
// tool gets both a name and an icon or neither.
const toolIcons: Record<string, Icon> = {
  get_editor_state: SquaresFourIcon,
  batch_get: BoundingBoxIcon,
  snapshot_layout: RulerIcon,
  get_screenshot: CameraIcon,
  get_variables: SwatchesIcon,
  get_text_styles: TextAaIcon,
  set_text_styles: TextAaIcon,
  batch_design: PencilSimpleIcon,
  set_variables: SlidersHorizontalIcon,
  replace_all_matching_properties: SwapIcon,
  find_empty_space_on_canvas: CrosshairIcon,
  search_all_unique_properties: MagnifyingGlassIcon,
  get_guidelines: BookOpenIcon,
  get_style_guide_tags: TagIcon,
  get_style_guide: PaletteIcon,
  search_screens: MagnifyingGlassIcon,
  get_screen: DeviceMobileIcon,
  search_flows: MagnifyingGlassIcon,
  get_flow: FlowArrowIcon,
  get_design_guidance: LightbulbIcon,
  refero_search_screens: MagnifyingGlassIcon,
  refero_get_screen: DeviceMobileIcon,
  refero_search_flows: MagnifyingGlassIcon,
  refero_get_flow: FlowArrowIcon,
  mcp_refero_search_screens: MagnifyingGlassIcon,
  mcp_refero_get_screen: DeviceMobileIcon,
  mcp_refero_search_flows: MagnifyingGlassIcon,
  mcp_refero_get_flow: FlowArrowIcon,
  mcp_refero_get_design_guidance: LightbulbIcon,
  ask_user: QuestionIcon,
  load_skill: BookOpenIcon,
  memory: BrainIcon,
  skill_manage: BookOpenIcon,
};

/** Falls back to a generic tool icon for anything unmapped. */
export function getToolIcon(toolName: string): Icon {
  return toolIcons[toolName] ?? WrenchIcon;
}
