import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/store/uiThemeStore"; // Initialize the editor theme store.

/**
 * The app-wide providers every editor-chrome page needs: one TooltipProvider
 * (shares hover-delay grouping across every IconButton/Tooltip, so do not
 * mount another closer to the leaves) and the sonner Toaster themed by the
 * editor's UI theme store. Shared by `App` (/app) and `AgentPage` (/agent).
 */
export function EditorProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delay={400} closeDelay={0}>
      {children}
      <Toaster />
    </TooltipProvider>
  );
}
