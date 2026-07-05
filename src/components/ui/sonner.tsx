import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useUIThemeStore } from "@/store/uiThemeStore";

// shadcn sonner Toaster, wired to the editor's own UI theme store rather than
// next-themes (the app doesn't use a next-themes provider — the light/dark
// class is driven by uiThemeStore). Colours map onto the shadcn CSS variables
// so toasts match the rest of the panels.
const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useUIThemeStore((s) => s.uiTheme);

  return (
    <Sonner
      theme={theme}
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
};

export { Toaster };
