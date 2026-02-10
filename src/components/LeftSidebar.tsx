import { LayersPanel } from "./LayersPanel";
import { ComponentsPanel } from "./ComponentsPanel";
import { Toolbar } from "./Toolbar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";

export function LeftSidebar() {
  return (
    <div className="w-[240px] h-full flex flex-col bg-surface-panel border-r border-border-default">
      <Toolbar />
      <Tabs defaultValue="layers" className="flex-1 flex flex-col gap-0 overflow-hidden">
        <div className="px-1 pt-1 pb-1 border-b border-border-default">
          <TabsList variant="pill">
            <TabsTrigger value="layers">Layers</TabsTrigger>
            <TabsTrigger value="components">Components</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="layers" className="flex-1 overflow-hidden">
          <LayersPanel />
        </TabsContent>
        <TabsContent value="components" className="flex-1 overflow-hidden">
          <ComponentsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
