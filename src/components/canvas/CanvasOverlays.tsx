interface ZoomIndicatorProps {
  scale: number;
  onFitToContent: () => void;
}

export function ZoomIndicator({ scale, onFitToContent }: ZoomIndicatorProps) {
  return (
    <div
      onClick={onFitToContent}
      className="absolute bottom-3 left-3 z-10 cursor-pointer select-none rounded bg-surface-panel/90 px-2 py-1 text-xs text-text-muted"
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
