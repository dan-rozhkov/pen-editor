import { useState } from "react";
import { useVariableStore } from "../store/variableStore";
import type { Variable, VariableScope, VariableType } from "../types/variable";
import { isLibraryOwned } from "../lib/designSystem/ownership";
import { deprecateVariable } from "../lib/designSystem/deprecation";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

const SCOPES_BY_TYPE: Record<VariableType, VariableScope[]> = {
  color: ["fill", "stroke", "text"],
  number: ["radius", "spacing", "gap", "size", "fontSize", "fontWeight", "opacity", "strokeWidth"],
  string: ["fontFamily"],
};

const labelClass = "text-[11px] font-semibold uppercase tracking-wide text-text-muted";

/** Text field that commits on blur / Enter, and only when the value changed. */
function CommitField({
  label,
  value,
  onCommit,
  multiline = false,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  // Re-sync the draft when the stored value changes under us (undo, other edit).
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className="flex flex-col gap-1">
      <span className={labelClass}>{label}</span>
      {multiline ? (
        <Textarea
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          className="min-h-12"
        />
      ) : (
        <Input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
      )}
    </label>
  );
}

/** Row expander body: description, scopes and the deprecation state of one variable. */
export function VariableDetails({ variable }: { variable: Variable }) {
  const variables = useVariableStore((s) => s.variables);
  const updateVariable = useVariableStore((s) => s.updateVariable);
  const scopes = variable.scopes ?? [];
  const deprecated = variable.deprecated;
  const replacements = variables.filter((v) => v.type === variable.type && v.id !== variable.id && !isLibraryOwned(v));

  const toggleScope = (scope: VariableScope, on: boolean) => {
    const next = on ? [...scopes, scope] : scopes.filter((s) => s !== scope);
    updateVariable(variable.id, { scopes: next.length > 0 ? next : undefined });
  };
  const patchDeprecation = (patch: Partial<NonNullable<Variable["deprecated"]>>) => {
    // A replacement goes through the same validation as the deprecate action.
    if (patch.replacedBy) {
      deprecateVariable(variable.id, { replacedBy: patch.replacedBy, note: deprecated?.note });
      return;
    }
    const next = { ...deprecated, ...patch };
    for (const key of Object.keys(next) as (keyof typeof next)[]) {
      if (next[key] === "" || next[key] === undefined) delete next[key];
    }
    updateVariable(variable.id, { deprecated: next });
  };

  const owned = isLibraryOwned(variable);

  return (
    <div className="flex flex-col gap-3 px-3 py-3" role="group" aria-label={`Details of ${variable.name}`} inert={owned}>
      <CommitField
        label="Description"
        multiline
        value={variable.description ?? ""}
        placeholder="What is this token for?"
        onCommit={(description) =>
          updateVariable(variable.id, { description: description.trim() || undefined })
        }
      />

      <fieldset className="flex flex-col gap-1.5 min-w-0">
        <legend className={labelClass}>Scopes</legend>
        <p className="text-[11px] text-text-muted">
          Where this variable may be applied. No scope selected means everywhere.
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {SCOPES_BY_TYPE[variable.type].map((scope) => (
            <div key={scope} className="flex items-center gap-1.5 text-xs text-text-secondary">
              <Checkbox
                id={`${variable.id}-scope-${scope}`}
                checked={scopes.includes(scope)}
                onCheckedChange={(checked) => toggleScope(scope, checked === true)}
              />
              <label htmlFor={`${variable.id}-scope-${scope}`}>{scope}</label>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Checkbox
            id={`${variable.id}-deprecated`}
            checked={deprecated !== undefined}
            onCheckedChange={(checked) =>
              updateVariable(variable.id, { deprecated: checked === true ? {} : undefined })
            }
          />
          <label htmlFor={`${variable.id}-deprecated`}>Deprecated</label>
        </div>
        {deprecated !== undefined && (
          <div className="grid grid-cols-1 gap-2">
            <CommitField
              label="Deprecated since"
              value={deprecated.since ?? ""}
              placeholder="e.g. 2.0"
              onCommit={(since) => patchDeprecation({ since })}
            />
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Replaced by</span>
              <select
                value={deprecated.replacedBy ?? ""}
                onChange={(e) => patchDeprecation({ replacedBy: e.target.value })}
                className="h-6 rounded-md bg-secondary px-2 text-xs text-secondary-foreground outline-none focus-visible:ring-1 focus-visible:ring-accent-light"
              >
                <option value="">None</option>
                {replacements.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <CommitField
              label="Deprecation note"
              value={deprecated.note ?? ""}
              onCommit={(note) => patchDeprecation({ note })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
