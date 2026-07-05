import type { ConstraintMode, NodeConstraints, SceneNode } from "@/types/scene";
import { cn } from "@/lib/utils";
import { toggleConstraintEdge } from "@/utils/constraintsLayout";
import {
  PropertySection,
  SelectInput,
} from "@/components/ui/PropertyInputs";

interface ConstraintsSectionProps {
  node: SceneNode;
  onUpdate: (updates: Partial<SceneNode>) => void;
}

const AXIS_OPTIONS: { value: ConstraintMode; label: string }[] = [
  { value: "min", label: "Left / Top" },
  { value: "max", label: "Right / Bottom" },
  { value: "center", label: "Center" },
  { value: "stretch", label: "Stretch" },
  { value: "scale", label: "Scale" },
];

const pinBaseClass = "absolute transition-colors";
const pinInactiveClass = "bg-border-default hover:bg-text-muted";
const pinActiveClass = "bg-accent-bright";

/**
 * Constraints panel for a direct child of a non-auto-layout frame: controls
 * how the child repositions/resizes when the parent frame is resized
 * (Figma parity). The classic "cross" widget's four edge pins toggle
 * min/max/stretch; the selects below cover the full mode set including
 * `center` and `scale` explicitly.
 */
export function ConstraintsSection({ node, onUpdate }: ConstraintsSectionProps) {
  const constraints: NodeConstraints = node.constraints ?? {
    horizontal: "min",
    vertical: "min",
  };
  const { horizontal, vertical } = constraints;

  const pinLeft = horizontal === "min" || horizontal === "stretch";
  const pinRight = horizontal === "max" || horizontal === "stretch";
  const pinTop = vertical === "min" || vertical === "stretch";
  const pinBottom = vertical === "max" || vertical === "stretch";

  const update = (next: Partial<NodeConstraints>) =>
    onUpdate({ constraints: { ...constraints, ...next } });

  return (
    <PropertySection title="Constraints">
      <div className="flex items-center gap-3">
        <div
          className="relative w-14 h-14 shrink-0 rounded border border-border-default bg-secondary/40"
          aria-label="Constraint cross"
        >
          <button
            type="button"
            aria-label="Pin left"
            aria-pressed={pinLeft}
            className={cn(
              pinBaseClass,
              "left-0 top-1/2 -translate-y-1/2 -ml-px w-1.5 h-5 rounded-sm",
              pinLeft ? pinActiveClass : pinInactiveClass,
            )}
            onClick={() => update({ horizontal: toggleConstraintEdge(horizontal, "start") })}
          />
          <button
            type="button"
            aria-label="Pin right"
            aria-pressed={pinRight}
            className={cn(
              pinBaseClass,
              "right-0 top-1/2 -translate-y-1/2 -mr-px w-1.5 h-5 rounded-sm",
              pinRight ? pinActiveClass : pinInactiveClass,
            )}
            onClick={() => update({ horizontal: toggleConstraintEdge(horizontal, "end") })}
          />
          <button
            type="button"
            aria-label="Pin top"
            aria-pressed={pinTop}
            className={cn(
              pinBaseClass,
              "top-0 left-1/2 -translate-x-1/2 -mt-px h-1.5 w-5 rounded-sm",
              pinTop ? pinActiveClass : pinInactiveClass,
            )}
            onClick={() => update({ vertical: toggleConstraintEdge(vertical, "start") })}
          />
          <button
            type="button"
            aria-label="Pin bottom"
            aria-pressed={pinBottom}
            className={cn(
              pinBaseClass,
              "bottom-0 left-1/2 -translate-x-1/2 -mb-px h-1.5 w-5 rounded-sm",
              pinBottom ? pinActiveClass : pinInactiveClass,
            )}
            onClick={() => update({ vertical: toggleConstraintEdge(vertical, "end") })}
          />
          <div className="absolute inset-3 rounded-sm border border-dashed border-text-muted" />
        </div>
        <div className="flex-1 flex flex-col gap-2">
          <SelectInput
            label="H"
            value={horizontal}
            options={AXIS_OPTIONS}
            onChange={(value) => update({ horizontal: value as ConstraintMode })}
          />
          <SelectInput
            label="V"
            value={vertical}
            options={AXIS_OPTIONS}
            onChange={(value) => update({ vertical: value as ConstraintMode })}
          />
        </div>
      </div>
    </PropertySection>
  );
}
