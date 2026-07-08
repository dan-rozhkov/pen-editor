import { SparkleIcon } from "@phosphor-icons/react";
import { PropertySection } from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TEXT_REWRITE_PRESETS } from "@/lib/textRewritePresets";
import { launchTextRewriteChat } from "@/lib/launchTextRewriteChat";

interface TextRewriteSectionProps {
  nodeIds: string[];
}

/**
 * "AI → Rewrite…" action for the selected text node(s) (Figma "Rewrite this"
 * analog). Shown in the properties panel whenever the whole selection is text
 * nodes; each preset launches a fresh Design Agent chat that rewrites every
 * selected node's text in a single request.
 */
export function TextRewriteSection({ nodeIds }: TextRewriteSectionProps) {
  return (
    <PropertySection title="AI">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="secondary" className="w-full justify-start gap-2" />}
        >
          <SparkleIcon className="size-3.5" weight="fill" />
          Rewrite…
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {TEXT_REWRITE_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.id}
              onClick={() => launchTextRewriteChat(nodeIds, preset)}
            >
              {preset.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </PropertySection>
  );
}
