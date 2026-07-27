import { Toaster as Sonner, type ToasterProps } from "sonner";

// The styled sonner portal, with the theme passed in rather than read from a
// store. Kept in its own module so the showcase route can mount it without
// importing `./sonner` — that one pulls in uiThemeStore, which applies the
// editor's `.dark` class on import (wrong for the showcase, whose shell is
// hardcoded light) and drags the scene store into the entry bundle.
// Colours map onto the shadcn CSS variables so toasts match the panels.
export const ToasterBase = ({ ...props }: ToasterProps) => (
  <Sonner
    position="bottom-right"
    className="toaster group"
    style={
      {
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
        "--border-radius": "var(--radius)",
      } as React.CSSProperties
    }
    {...props}
  />
);
