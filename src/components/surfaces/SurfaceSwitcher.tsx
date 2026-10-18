import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSurfaceStore } from "@/store/surfaceStore";
import { getAvailableSurfaces, type SurfaceId } from "@/surfaces/meta";

/**
 * Segmented switch between the surfaces of the main work area. Built from
 * the available surfaces, so a new surface appears here without touching this file.
 */
export function SurfaceSwitcher() {
  const activeSurfaceId = useSurfaceStore((s) => s.activeSurfaceId);
  const setActiveSurface = useSurfaceStore((s) => s.setActiveSurface);

  const surfaces = getAvailableSurfaces();
  // One surface left means nothing to switch between.
  if (surfaces.length < 2) return null;

  return (
    <Tabs
      value={activeSurfaceId}
      onValueChange={(value) => setActiveSurface(value as SurfaceId)}
      className="rounded-xl border border-border-default bg-surface-panel shadow-sm"
    >
      <TabsList aria-label="Surface" variant="pill" className="h-8">
        {surfaces.map((surface) => (
          <TabsTrigger key={surface.id} value={surface.id} data-testid={`surface-tab-${surface.id}`}>
            {surface.title}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
