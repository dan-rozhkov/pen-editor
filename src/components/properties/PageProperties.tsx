import { useSceneStore } from "@/store/sceneStore";
import { ColorInput, PropertySection } from "@/components/ui/PropertyInputs";
import { PageExportSection } from "@/components/properties/PageExportSection";

export function PageProperties() {
  const pageBackground = useSceneStore((s) => s.pageBackground);
  const setPageBackground = useSceneStore((s) => s.setPageBackground);

  return (
    <div>
      <PropertySection title="Background">
        <ColorInput value={pageBackground} onChange={setPageBackground} />
      </PropertySection>
      <PageExportSection />
    </div>
  );
}
