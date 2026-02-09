interface ZoomIndicatorProps {
  scale: number;
  onFitToContent: () => void;
}

export function ZoomIndicator({ scale, onFitToContent }: ZoomIndicatorProps) {
  return (
    <div
      onClick={onFitToContent}
      style={{
        position: "absolute",
        bottom: 12,
        left: 12,
        background: "rgba(255, 255, 255, 0.9)",
        padding: "4px 8px",
        borderRadius: 4,
        fontSize: 12,
        fontFamily: "system-ui, sans-serif",
        color: "#666",
        zIndex: 10,
        cursor: "pointer",
        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
        userSelect: "none",
      }}
      title="Click to fit all (Cmd/Ctrl+0)"
    >
      {Math.round(scale * 100)}%
    </div>
  );
}

interface FpsDisplayProps {
  fps: number | null;
}

export function FpsDisplay({ fps }: FpsDisplayProps) {
  if (!import.meta.env.DEV || fps === null) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        background: "rgba(0, 0, 0, 0.65)",
        padding: "4px 6px",
        borderRadius: 4,
        fontSize: 11,
        fontFamily: "system-ui, sans-serif",
        color: "#fff",
        zIndex: 10,
        userSelect: "none",
      }}
      title="FPS (dev only)"
    >
      {fps} fps
    </div>
  );
}
