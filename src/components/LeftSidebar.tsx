import { useState } from "react";
import { ArrowsInLineVertical, SidebarSimple } from "@phosphor-icons/react";
import { LayersPanel } from "./LayersPanel";
import { ComponentsPanel } from "./ComponentsPanel";
import { Toolbar } from "./Toolbar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { useSceneStore } from "@/store/sceneStore";
import { useFloatingPanelsStore } from "@/store/floatingPanelsStore";

export function LeftSidebar() {
  const [activeTab, setActiveTab] = useState("layers");
  const collapseAllFrames = useSceneStore((s) => s.collapseAllFrames);
  const hasExpanded = useSceneStore((s) => s.expandedFrameIds.size > 0);
  const isFloating = useFloatingPanelsStore((s) => s.isFloating);
  const toggleFloating = useFloatingPanelsStore((s) => s.toggleFloating);

  return (
    <div
      className={
        isFloating
          ? "flex flex-col bg-surface-panel rounded-2xl shadow-[0_0px_3px_rgba(0,0,0,0.04)] border border-border-default overflow-hidden"
          : "w-[240px] h-full flex flex-col bg-surface-panel border-r border-border-default"
      }
    >
      <div className={isFloating ? "flex flex-row items-center gap-1 px-2 py-0.5" : "flex flex-row items-center gap-0 pr-1 border-b border-border-default"}>
        <div className="flex-1 min-w-0">
          <Toolbar />
        </div>
        <button
          onClick={toggleFloating}
          className="p-1.5 rounded transition-colors text-text-muted hover:text-text-default hover:bg-surface-hover"
          title={isFloating ? "Dock panels" : "Float panels"}
          data-testid="sidebar-toggle"
        >
          <SidebarSimple size={16} />
        </button>
      </div>
      {!isFloating && (
        <Tabs defaultValue="layers" className="flex-1 flex flex-col gap-0 overflow-hidden" onValueChange={setActiveTab}>
          <div className="px-1 pt-1 pb-1 border-b border-border-default flex items-center justify-between">
            <TabsList variant="pill">
              <TabsTrigger value="layers">Layers</TabsTrigger>
              <TabsTrigger value="components">Components</TabsTrigger>
            </TabsList>
            {activeTab === "layers" && hasExpanded && (
              <button
                onClick={collapseAllFrames}
                className="p-1 rounded text-text-muted hover:text-text-default hover:bg-surface-hover transition-colors"
                title="Collapse all"
              >
                <ArrowsInLineVertical size={14} />
              </button>
            )}
          </div>
          <TabsContent value="layers" className="flex-1 overflow-hidden">
            <LayersPanel />
          </TabsContent>
          <TabsContent value="components" className="flex-1 overflow-hidden">
            <ComponentsPanel />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
