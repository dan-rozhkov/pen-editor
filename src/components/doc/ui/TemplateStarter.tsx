import { Button } from "@/components/ui/button";
import type { DocTemplate } from "@/lib/docs/docTemplates";

/** "Start from a template" under the title, shown only while the document body is empty. */
export function TemplateStarter({ templates, onPick }: { templates: DocTemplate[]; onPick: (template: DocTemplate) => void }) {
  return (
    <div role="group" aria-label="Start from a template" className="mb-1 mt-3 flex flex-wrap items-center gap-1.5">
      <span className="text-text-muted mr-1 text-xs">Start from a template</span>
      {templates.map((template) => (
        <Button key={template.id} variant="outline" size="sm" title={template.description} onClick={() => onPick(template)}>
          {template.label}
        </Button>
      ))}
    </div>
  );
}
