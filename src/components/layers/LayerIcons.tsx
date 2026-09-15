import {
  RectangleIcon,
  CircleIcon,
  TextTIcon,
  EyeIcon as EyeIconIcon,
  EyeSlashIcon,
  CaretRightIcon,
  PenNibIcon,
  SelectionIcon,
  LineSegmentIcon,
  HexagonIcon,
  HashStraight,
  CodeIcon,
  FlowArrow,
  ScissorsIcon,
  ImageSquareIcon,
} from "@phosphor-icons/react";
import clsx from "clsx";
import type { SceneNode, LayoutProperties } from "../../types/scene";
import type { EmbedLayerKind } from "@/lib/embedLayerTree";

// Auto-layout alignment icon — shows 2 outlined bars positioned according to layout settings
const AutoLayoutIcon = ({ layout }: { layout: LayoutProperties }) => {
  const direction = layout.flexDirection ?? "row";
  const alignItems = layout.alignItems ?? "flex-start";
  const justifyContent = layout.justifyContent ?? "flex-start";
  const isRow = direction === "row";

  const sizes = [7, 5];
  const thick = 3.5;
  const sw = 1;
  const pad = 2.5;
  const area = 11; // 16 - 2*pad

  const gap = 2;
  const totalMain = thick * 2 + gap;
  let mainPositions: number[];
  switch (justifyContent) {
    case "center": {
      const s = pad + (area - totalMain) / 2;
      mainPositions = [s, s + thick + gap];
      break;
    }
    case "flex-end": {
      const s = pad + area - totalMain;
      mainPositions = [s, s + thick + gap];
      break;
    }
    case "space-between":
    case "space-around":
    case "space-evenly":
      mainPositions = [pad, pad + area - thick];
      break;
    default: // flex-start
      mainPositions = [pad, pad + thick + gap];
  }

  const crossPositions = sizes.map((size) => {
    switch (alignItems) {
      case "center":
        return pad + (area - size) / 2;
      case "flex-end":
        return pad + area - size;
      case "stretch":
        return pad;
      default: // flex-start
        return pad;
    }
  });

  const stretchedSizes = sizes.map((size) =>
    alignItems === "stretch" ? area : size,
  );

  const bars = stretchedSizes.map((size, i) =>
    isRow
      ? { x: mainPositions[i], y: crossPositions[i], width: thick, height: size }
      : { x: crossPositions[i], y: mainPositions[i], width: size, height: thick },
  );

  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      className="w-4 h-4 shrink-0 text-text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
    >
      {bars.map((bar, i) => (
        <rect
          key={i}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          rx={0.5}
        />
      ))}
    </svg>
  );
};

export const NodeIcon = ({
  type,
  isMask,
  layout,
}: {
  type: SceneNode["type"];
  isMask?: boolean;
  layout?: LayoutProperties;
}) => {
  const iconClass = clsx("w-4 h-4 shrink-0", "text-text-muted");

  // Figma-style mask indicator: overrides the type icon so masking layers
  // (of any node type) are immediately recognizable in the layers panel.
  if (isMask) {
    return (
      <ScissorsIcon
        size={16}
        className={clsx("w-4 h-4 shrink-0 text-accent-bright")}
        weight="regular"
      />
    );
  }

  switch (type) {
    case "frame":
      if (layout?.autoLayout) {
        return <AutoLayoutIcon layout={layout} />;
      }
      return <HashStraight size={16} className={iconClass} weight="regular" />;
    case "group":
      return <SelectionIcon size={16} className={iconClass} />;
    case "rect":
      return <RectangleIcon size={16} className={iconClass} weight="regular" />;
    case "ellipse":
      return <CircleIcon size={16} className={iconClass} weight="regular" />;
    case "text":
      return <TextTIcon size={16} className={iconClass} weight="regular" />;
    case "path":
      return <PenNibIcon size={16} className={iconClass} weight="regular" />;
    case "line":
      return <LineSegmentIcon size={16} className={iconClass} weight="regular" />;
    case "polygon":
      return <HexagonIcon size={16} className={iconClass} weight="regular" />;
    case "embed":
      return <CodeIcon size={16} className={iconClass} weight="regular" />;
    case "connector":
      return <FlowArrow size={16} className={iconClass} weight="regular" />;
    default:
      return null;
  }
};

/** Maps an embed-element row's `kind` (from `embedLayerTree.ts`) to the icon
 * a plain (non-component/slot/mask/auto-layout) native node of the closest
 * matching type gets — "closest matching" because an embed element isn't a
 * scene node and has no `NodeIcon` case of its own. Delegates to `NodeIcon`
 * for the three kinds that DO have an exact type equivalent (a jscpd
 * duplication gate runs in CI, so this must not re-render the same SVGs);
 * "image" has no scene-node equivalent (no bitmap-fill node type), so it
 * gets its own Phosphor icon instead. */
export const EmbedElementIcon = ({ kind }: { kind: EmbedLayerKind }) => {
  if (kind === "image") {
    return (
      <ImageSquareIcon
        size={16}
        className={clsx("w-4 h-4 shrink-0", "text-text-muted")}
        weight="regular"
      />
    );
  }

  const nodeType: SceneNode["type"] = kind === "text" ? "text" : kind === "shape" ? "rect" : "frame";
  return <NodeIcon type={nodeType} />;
};

export const EyeIcon = ({ visible }: { visible: boolean }) => {
  const iconClass = clsx("w-4 h-4", "text-text-muted");

  return visible ? (
    <EyeIconIcon size={16} className={iconClass} weight="regular" />
  ) : (
    <EyeSlashIcon size={16} className={iconClass} weight="regular" />
  );
};

export const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <CaretRightIcon
    size={10}
    className={clsx(
      "w-2.5 h-2.5",
      "text-text-muted",
      expanded && "rotate-90",
    )}
    weight="bold"
  />
);
