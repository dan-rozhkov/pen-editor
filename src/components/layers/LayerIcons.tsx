import {
  DiamondIcon,
  DiamondsFourIcon,
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
} from "@phosphor-icons/react";
import clsx from "clsx";
import type { SceneNode, LayoutProperties } from "../../types/scene";

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
  isComponent,
  layout,
}: {
  type: SceneNode["type"];
  isComponent?: boolean;
  layout?: LayoutProperties;
}) => {
  const iconClass = clsx("w-4 h-4 shrink-0", "text-text-muted");

  switch (type) {
    case "frame":
      if (isComponent) {
        return <DiamondsFourIcon size={16} className={iconClass} weight="regular" />;
      }
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
      if (isComponent) {
        return <DiamondsFourIcon size={16} className={iconClass} weight="regular" />;
      }
      return <CodeIcon size={16} className={iconClass} weight="regular" />;
    case "ref":
      return <DiamondIcon size={16} className={iconClass} weight="regular" />;
    case "connector":
      return <FlowArrow size={16} className={iconClass} weight="regular" />;
    default:
      return null;
  }
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
