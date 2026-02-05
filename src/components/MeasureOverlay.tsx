import { Line, Group, Rect, Text } from "react-konva";
import { useMeasureStore } from "@/store/measureStore";
import { useViewportStore } from "@/store/viewportStore";
import type { MeasureLine } from "@/store/measureStore";

const MEASURE_COLOR = "#f24822";
const LABEL_PADDING_X = 4;
const LABEL_PADDING_Y = 2;
const LABEL_FONT_SIZE = 11;

function MeasureLineComponent({
  line,
  scale,
}: {
  line: MeasureLine;
  scale: number;
}) {
  const invScale = 1 / scale;

  // Compute line endpoints
  let x1: number, y1: number, x2: number, y2: number;
  if (line.orientation === "horizontal") {
    x1 = line.x;
    y1 = line.y;
    x2 = line.x + line.length;
    y2 = line.y;
  } else {
    x1 = line.x;
    y1 = line.y;
    x2 = line.x;
    y2 = line.y + line.length;
  }

  // Label position: center of the line
  const labelX = (x1 + x2) / 2;
  const labelY = (y1 + y2) / 2;

  const fontSize = LABEL_FONT_SIZE * invScale;
  const paddingX = LABEL_PADDING_X * invScale;
  const paddingY = LABEL_PADDING_Y * invScale;
  const textWidth = line.label.length * fontSize * 0.65;
  const boxWidth = textWidth + paddingX * 2;
  const boxHeight = fontSize + paddingY * 2;

  // Endpoint caps (small perpendicular ticks)
  const capSize = 4 * invScale;
  let capPoints1: number[], capPoints2: number[];
  if (line.orientation === "horizontal") {
    capPoints1 = [x1, y1 - capSize, x1, y1 + capSize];
    capPoints2 = [x2, y2 - capSize, x2, y2 + capSize];
  } else {
    capPoints1 = [x1 - capSize, y1, x1 + capSize, y1];
    capPoints2 = [x2 - capSize, y2, x2 + capSize, y2];
  }

  return (
    <Group listening={false}>
      {/* Main measurement line */}
      <Line
        points={[x1, y1, x2, y2]}
        stroke={MEASURE_COLOR}
        strokeWidth={invScale}
        perfectDrawEnabled={false}
        listening={false}
      />
      {/* End caps */}
      <Line
        points={capPoints1}
        stroke={MEASURE_COLOR}
        strokeWidth={invScale}
        perfectDrawEnabled={false}
        listening={false}
      />
      <Line
        points={capPoints2}
        stroke={MEASURE_COLOR}
        strokeWidth={invScale}
        perfectDrawEnabled={false}
        listening={false}
      />
      {/* Label background */}
      <Rect
        x={labelX - boxWidth / 2}
        y={labelY - boxHeight / 2}
        width={boxWidth}
        height={boxHeight}
        fill={MEASURE_COLOR}
        cornerRadius={2 * invScale}
        perfectDrawEnabled={false}
        listening={false}
      />
      {/* Label text */}
      <Text
        x={labelX - boxWidth / 2}
        y={labelY - boxHeight / 2 + paddingY}
        width={boxWidth}
        align="center"
        text={line.label}
        fontSize={fontSize}
        fill="#ffffff"
        fontFamily="system-ui, sans-serif"
        perfectDrawEnabled={false}
        listening={false}
      />
    </Group>
  );
}

export function MeasureOverlay() {
  const lines = useMeasureStore((state) => state.lines);
  const scale = useViewportStore((state) => state.scale);

  if (lines.length === 0) return null;

  return (
    <>
      {lines.map((line, i) => (
        <MeasureLineComponent key={i} line={line} scale={scale} />
      ))}
    </>
  );
}
