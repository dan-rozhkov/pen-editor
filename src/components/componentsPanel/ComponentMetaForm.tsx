import { useId, useState, type FormEvent } from "react";
import type { ComponentMaster } from "@/lib/embedComponents";
import type { EmbedComponentMeta } from "@/types/scene";
import { defineComponent } from "@/lib/tools/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const SELECT_CLASS =
  "h-7 w-full rounded-md bg-secondary px-2 text-xs text-secondary-foreground outline-none focus-visible:ring-1 focus-visible:ring-accent-light";

type Status = NonNullable<EmbedComponentMeta["status"]>;

interface ComponentMetaFormProps {
  master: ComponentMaster;
  /** Keys of the other components, offered as the replacement. */
  otherKeys: string[];
  onDone: () => void;
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] text-text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Edit form for a local master's meta. Saves through the `define_component` handler. */
export function ComponentMetaForm({ master, otherKeys, onDone }: ComponentMetaFormProps) {
  const { meta } = master;
  const uid = useId();
  const [name, setName] = useState(meta.name);
  const [description, setDescription] = useState(meta.description ?? "");
  const [status, setStatus] = useState<Status | "">(meta.status ?? "");
  const [replacedBy, setReplacedBy] = useState(meta.deprecated?.replacedBy ?? "");
  const [note, setNote] = useState(meta.deprecated?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const replacementOptions = otherKeys.includes(replacedBy) || !replacedBy ? otherKeys : [replacedBy, ...otherKeys];

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    const raw = await defineComponent({
      key: meta.key,
      name,
      html: master.html,
      description,
      status: status || null,
      deprecated: status === "deprecated" ? { replacedBy, note } : null,
    });
    setSaving(false);
    const result = JSON.parse(raw) as { error?: string };
    if (result.error) {
      setError(result.error);
      return;
    }
    onDone();
  }

  return (
    <form
      aria-label={`Edit details of ${meta.name}`}
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-2 border-t border-border-default pt-2"
    >
      <Field id={`${uid}-name`} label="Name">
        <Input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} className="h-7" />
      </Field>
      <Field id={`${uid}-desc`} label="Description">
        <Textarea
          id={`${uid}-desc`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-12"
        />
      </Field>
      <Field id={`${uid}-status`} label="Status">
        <select
          id={`${uid}-status`}
          value={status}
          onChange={(e) => setStatus(e.target.value as Status | "")}
          className={SELECT_CLASS}
        >
          <option value="">Not set</option>
          <option value="draft">Draft</option>
          <option value="stable">Stable</option>
          <option value="deprecated">Deprecated</option>
        </select>
      </Field>
      {status === "deprecated" && (
        <>
          <Field id={`${uid}-replaced`} label="Replaced by">
            <select
              id={`${uid}-replaced`}
              value={replacedBy}
              onChange={(e) => setReplacedBy(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">None</option>
              {replacementOptions.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${uid}-note`} label="Deprecation note">
            <Input id={`${uid}-note`} value={note} onChange={(e) => setNote(e.target.value)} className="h-7" />
          </Field>
        </>
      )}
      {error && (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          Save
        </Button>
      </div>
    </form>
  );
}
