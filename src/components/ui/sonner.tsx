import { type ToasterProps } from "sonner";
import { useUIThemeStore } from "@/store/uiThemeStore";
import { ToasterBase } from "./ToasterBase";

// The editor's sonner Toaster: ToasterBase wired to the app's own UI theme
// store rather than next-themes (the app doesn't use a next-themes provider —
// the light/dark class is driven by uiThemeStore).
const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useUIThemeStore((s) => s.uiTheme);

  return <ToasterBase theme={theme} {...props} />;
};

export { Toaster };
