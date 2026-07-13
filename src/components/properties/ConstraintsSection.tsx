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

const pinBaseClass = "absolute z-10 flex h-5 w-5 items-center justify-center transition-colors before:rounded-full";
const pinInactiveClass = "before:bg-text-muted hover:before:bg-text-primary";
const pinActiveClass = "before:bg-accent-bright";

function AxisIcon({ axis }: { axis: "horizontal" | "vertical" }) {
  return (
    <svg aria-hidden="true" className="size-3 shrink-0 text-text-muted" viewBox="0 0 12 12" fill="none">
      {axis === "horizontal" ? (
        <path d="M1 6H11M1 4V8M11 4V8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      ) : (
        <path d="M6 1V11M4 1H8M4 11H8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      )}
    </svg>
  );
}

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
      <div className="flex items-center gap-3">
        <div
          className="relative h-14 w-20 shrink-0 overflow-hidden rounded-md bg-secondary"
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
                    "left-1 top-1/2 -translate-y-1/2 before:h-px before:w-2.5",
                    pinLeft ? `${pinActiveClass} before:h-[3px]` : pinInactiveClass,
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
                    "right-1 top-1/2 -translate-y-1/2 before:h-px before:w-2.5",
                    pinRight ? `${pinActiveClass} before:h-[3px]` : pinInactiveClass,
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
                    "left-1/2 top-0 -translate-x-1/2 before:h-2.5 before:w-px",
                    pinTop ? `${pinActiveClass} before:w-[3px]` : pinInactiveClass,
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
                    "bottom-0 left-1/2 -translate-x-1/2 before:h-2.5 before:w-px",
                    pinBottom ? `${pinActiveClass} before:w-[3px]` : pinInactiveClass,
                  )}
                  onClick={() => update({ vertical: toggleConstraintEdge(vertical, "end") })}
                />
              }
            />
            <TooltipContent>
              <span>Pin bottom</span>
            </TooltipContent>
          </Tooltip>
          <div className="absolute left-6 top-3 h-8 w-8 rounded-md border border-border-default" />
          <div className="absolute left-1/2 top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-text-muted" />
          <div className="absolute left-1/2 top-1/2 h-px w-2.5 -translate-x-1/2 -translate-y-1/2 bg-text-muted" />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <SelectInput
            value={horizontal}
            options={AXIS_OPTIONS}
            prefix={<AxisIcon axis="horizontal" />}
            onChange={(value) => update({ horizontal: value as ConstraintMode })}
          />
          <SelectInput
            value={vertical}
            options={AXIS_OPTIONS}
            prefix={<AxisIcon axis="vertical" />}
            onChange={(value) => update({ vertical: value as ConstraintMode })}
          />
        </div>
      </div>
    </PropertySection>
  );
}
