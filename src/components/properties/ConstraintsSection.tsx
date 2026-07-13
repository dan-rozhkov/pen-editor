import type { ConstraintMode, NodeConstraints, SceneNode } from "@/types/scene";
import { cn } from "@/lib/utils";
import { toggleConstraintEdge } from "@/utils/constraintsLayout";
import {
  PropertySection,
  SelectInput,
} from "@/components/ui/PropertyInputs";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

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

const pinBaseClass = "absolute z-10 transition-colors";
const pinInactiveClass = "bg-border-default hover:bg-text-muted";
const pinActiveClass = "bg-accent-bright";

/**
 * Constraints panel for a direct child of a non-auto-layout frame: controls
 * how the child repositions/resizes when the parent frame is resized
 * (Figma parity). The classic Figma-style constraint widget's four edge pins toggle
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
      <div className="flex flex-col gap-3">
        <div
          className="relative h-28 w-44 shrink-0 overflow-hidden rounded-[10px] bg-secondary"
          aria-label="Constraint cross"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Pin left"
                  aria-pressed={pinLeft}
                  className={cn(
                    pinBaseClass,
                    "left-2 top-1/2 h-1.5 w-5 -translate-y-1/2 rounded-full",
                    pinLeft ? pinActiveClass : pinInactiveClass,
                  )}
                  onClick={() => update({ horizontal: toggleConstraintEdge(horizontal, "start") })}
                />
              }
            />
            <TooltipContent>
              <span>Pin left</span>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Pin right"
                  aria-pressed={pinRight}
                  className={cn(
                    pinBaseClass,
                    "right-2 top-1/2 h-1.5 w-5 -translate-y-1/2 rounded-full",
                    pinRight ? pinActiveClass : pinInactiveClass,
                  )}
                  onClick={() => update({ horizontal: toggleConstraintEdge(horizontal, "end") })}
                />
              }
            />
            <TooltipContent>
              <span>Pin right</span>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Pin top"
                  aria-pressed={pinTop}
                  className={cn(
                    pinBaseClass,
                    "left-1/2 top-1 h-5 w-1.5 -translate-x-1/2 rounded-full",
                    pinTop ? pinActiveClass : pinInactiveClass,
                  )}
                  onClick={() => update({ vertical: toggleConstraintEdge(vertical, "start") })}
                />
              }
            />
            <TooltipContent>
              <span>Pin top</span>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Pin bottom"
                  aria-pressed={pinBottom}
                  className={cn(
                    pinBaseClass,
                    "bottom-1 left-1/2 h-5 w-1.5 -translate-x-1/2 rounded-full",
                    pinBottom ? pinActiveClass : pinInactiveClass,
                  )}
                  onClick={() => update({ vertical: toggleConstraintEdge(vertical, "end") })}
                />
              }
            />
            <TooltipContent>
              <span>Pin bottom</span>
            </TooltipContent>
          </Tooltip>
          <div className="absolute left-8 top-8 h-12 w-28 rounded-[10px] border-2 border-border-default bg-surface-panel" />
          <div className="absolute left-1/2 top-1/2 h-7 w-px -translate-x-1/2 -translate-y-1/2 bg-text-muted" />
          <div className="absolute left-1/2 top-1/2 h-px w-7 -translate-x-1/2 -translate-y-1/2 bg-text-muted" />
        </div>
        <div className="flex flex-col gap-2">
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
