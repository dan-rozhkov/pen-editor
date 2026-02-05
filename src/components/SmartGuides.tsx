import { Line } from "react-konva";
import { useSmartGuideStore } from "@/store/smartGuideStore";
import { useViewportStore } from "@/store/viewportStore";

export function SmartGuides() {
  const guides = useSmartGuideStore((state) => state.guides);
  const scale = useViewportStore((state) => state.scale);

  if (guides.length === 0) return null;

  return (
    <>
      {guides.map((guide, i) => {
        const points =
          guide.orientation === "vertical"
            ? [guide.position, guide.start, guide.position, guide.end]
            : [guide.start, guide.position, guide.end, guide.position];

        return (
          <Line
            key={i}
            points={points}
            stroke="#ff3366"
            strokeWidth={1 / scale}
            perfectDrawEnabled={false}
            listening={false}
          />
        );
      })}
    </>
  );
}
