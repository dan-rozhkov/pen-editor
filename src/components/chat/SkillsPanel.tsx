import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpenIcon,
  DotsThreeVertical,
  MagicWandIcon,
  PlusIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useUserSkillStore } from "@/store/userSkillStore";
import type { UserSkill } from "@/lib/userSkills";
import { parseSkillMarkdown, serializeSkillMarkdown } from "@/lib/userSkills";
import { downloadMarkdown } from "@/lib/chatExport";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PanelEmptyState } from "@/components/PanelEmptyState";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface SkillsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type View = "list" | "form" | "generate";

interface FormState {
  /** Original name, when editing an existing skill; null for a new one (create
   * or a not-yet-saved generated draft). Renaming sends this as the lookup key. */
  originalName: string | null;
  name: string;
  description: string;
  body: string;
  source: "manual" | "upload" | "generated";
}

const EMPTY_FORM: FormState = {
  originalName: null,
  name: "",
  description: "",
  body: "",
  source: "manual",
};

const NAME_RE = /^[a-z][a-z0-9-]{1,48}$/;

/** Mirrors the backend's validation (see user-skills-spec.md) so the panel can
 * surface a message before ever hitting the network — the backend remains
 * the source of truth and its own error still wins on save. */
function validateForm(form: FormState): string | null {
  const name = form.name.trim();
  if (!name) return "Name is required.";
  if (!NAME_RE.test(name)) {
    return "Name must start with a lowercase letter and contain only lowercase letters, digits and hyphens.";
  }
  const description = form.description.trim();
  if (description.length > 200) return "Description must be 200 characters or fewer.";
  if (description.includes("\n")) return "Description must be a single line.";
  const body = form.body.trim();
  if (!body) return "Instructions can't be empty.";
  if (body.length > 24000) return "Instructions must be 24,000 characters or fewer.";
  return null;
}

/**
 * "Manage skills" surface (Figma-style custom skills for the design agent).
 * Modeled on PluginsPanel.tsx: a searchable/browsable list with per-item
 * actions, plus create/upload/generate flows layered on top as a single
 * modal (rather than a left-sidebar panel, since it's reached from the chat
 * header and the slash menu rather than the Toolbox rail).
 */
export function SkillsPanel({ open, onOpenChange }: SkillsPanelProps) {
  const builtIn = useUserSkillStore((s) => s.builtIn);
  const skills = useUserSkillStore((s) => s.skills);
  const available = useUserSkillStore((s) => s.available);
  const status = useUserSkillStore((s) => s.status);
  const storeError = useUserSkillStore((s) => s.error);
  const pendingUpdates = useUserSkillStore((s) => s.pendingUpdates);
  const ensureHydrated = useUserSkillStore((s) => s.ensureHydrated);
  const refresh = useUserSkillStore((s) => s.refresh);
  const create = useUserSkillStore((s) => s.create);
  const update = useUserSkillStore((s) => s.update);
  const remove = useUserSkillStore((s) => s.remove);
  const generate = useUserSkillStore((s) => s.generate);

  const [view, setView] = useState<View>("list");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-hydrate on open, but only when we're not already sitting on a
  // failed attempt — a failure is recovered explicitly via the Retry button
  // (wired to refresh()) rather than by silently re-fetching every time the
  // panel is reopened.
  useEffect(() => {
    if (open && status !== "error") void ensureHydrated();
  }, [open, status, ensureHydrated]);

  // Reset to the list whenever the modal transitions from closed to open, so
  // a stale in-progress create/edit form never greets the user next time
  // they open it. Adjusting state during render rather than in an effect,
  // per React's "adjusting state when a prop changes" pattern — this avoids
  // an extra committed render with the stale form still visible.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setView("list");
      setForm(EMPTY_FORM);
      setFormError(null);
      setPrompt("");
      setDropError(null);
    }
  }

  const deletingSkill = deletingName ? (skills.find((s) => s.name === deletingName) ?? null) : null;

  const openCreateForm = useCallback(() => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setView("form");
  }, []);

  const openEditForm = useCallback((skill: UserSkill) => {
    setForm({
      originalName: skill.name,
      name: skill.name,
      description: skill.description,
      body: skill.body,
      source: skill.source,
    });
    setFormError(null);
    setView("form");
  }, []);

  const applyParsedMarkdown = useCallback((raw: string) => {
    const parsed = parseSkillMarkdown(raw);
    setForm({
      originalName: null,
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      source: "upload",
    });
    setFormError(null);
    setView("form");
  }, []);

  const handleUploadFile = useCallback(
    async (file: File) => {
      setDropError(null);
      applyParsedMarkdown(await file.text());
    },
    [applyParsedMarkdown],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) void handleUploadFile(file);
    },
    [handleUploadFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = Array.from(e.dataTransfer.files).find(
        (f) => f.name.toLowerCase().endsWith(".md") || f.type === "text/markdown",
      );
      if (file) {
        void handleUploadFile(file);
      } else {
        setDropError("Drop a .md file to import a skill.");
      }
    },
    [handleUploadFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleSaveForm = useCallback(async () => {
    const error = validateForm(form);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    setSaving(true);
    const name = form.name.trim();
    const description = form.description.trim();
    const body = form.body.trim();

    const result = form.originalName
      ? await update(form.originalName, { newName: name, description, body })
      : await create({ name, description, body, source: form.source });

    setSaving(false);
    if (result) {
      setView("list");
      setForm(EMPTY_FORM);
    } else {
      setFormError(useUserSkillStore.getState().error);
    }
  }, [form, create, update]);

  const handleToggleEnabled = useCallback(
    (skill: UserSkill) => {
      void update(skill.name, { enabled: !skill.enabled });
    },
    [update],
  );

  const handleExport = useCallback((skill: UserSkill) => {
    downloadMarkdown(serializeSkillMarkdown(skill), `${skill.name}.md`);
  }, []);

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setGenerating(true);
    const draft = await generate(trimmed);
    setGenerating(false);
    if (draft) {
      setForm({
        originalName: null,
        name: draft.name,
        description: draft.description,
        body: draft.body,
        source: "generated",
      });
      setFormError(null);
      setView("form");
    }
  }, [prompt, generate]);

  const title =
    view === "list" ? "Manage skills" : view === "generate" ? "Generate a skill" : form.originalName ? "Edit skill" : "New skill";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {view === "list" && (
            <DialogDescription>
              Skills teach the design agent your workflows. Built-in skills are shared
              and read-only; your own skills are private to you.
            </DialogDescription>
          )}
        </DialogHeader>

        {storeError && view === "list" && status !== "error" && (
          <InlineAlert variant="error">{storeError}</InlineAlert>
        )}

        {view === "list" && (
          <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
            <section>
              <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-text-muted uppercase">
                Built-in
              </h3>
              {builtIn.length === 0 ? (
                <p className="px-1 text-xs text-text-muted">No built-in skills available.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {builtIn.map((skill) => (
                    <li
                      key={skill.name}
                      className="rounded-lg px-2 py-1.5"
                      data-testid={`builtin-skill-${skill.name}`}
                    >
                      <div className="text-xs font-medium text-text-primary">/{skill.name}</div>
                      <p className="text-xs text-text-muted">{skill.description}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <div className="mb-1.5 flex items-center gap-2">
                <h3 className="flex-1 text-[11px] font-medium tracking-wide text-text-muted uppercase">
                  Your skills
                </h3>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,text/markdown"
                  className="hidden"
                  onChange={handleFileInputChange}
                  aria-label="Upload skill file"
                />
                <IconButton
                  tooltip="Upload .md"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UploadSimpleIcon size={16} />
                </IconButton>
                <IconButton
                  tooltip="Generate with the agent"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setView("generate")}
                >
                  <MagicWandIcon size={16} />
                </IconButton>
                <IconButton tooltip="New skill" variant="ghost" size="icon-sm" onClick={openCreateForm}>
                  <PlusIcon size={16} />
                </IconButton>
              </div>

              {dropError && <InlineAlert variant="error">{dropError}</InlineAlert>}

              {status === "error" ? (
                <div className="flex flex-col items-start gap-2 px-1">
                  <p className="text-xs text-text-muted">
                    Couldn't load your skills{storeError ? `: ${storeError}` : "."}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => void refresh()}>
                    Retry
                  </Button>
                </div>
              ) : !available ? (
                <p className="px-1 text-xs text-text-muted">
                  Skill sync needs the backend to be configured — custom skills aren't
                  available on this deployment yet.
                </p>
              ) : status === "loading" ? (
                <p className="px-1 text-xs text-text-muted">Loading…</p>
              ) : null}

              {available && status !== "loading" && status !== "error" && skills.length === 0 && (
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className={
                    isDragOver
                      ? "rounded-lg border-2 border-dashed border-accent-light bg-secondary/60"
                      : "rounded-lg border-2 border-dashed border-transparent"
                  }
                >
                  <PanelEmptyState
                    icon={
                      <BookOpenIcon aria-hidden data-testid="skills-empty-state-icon" size={28} weight="light" />
                    }
                  >
                    No skills yet — create one, drop a .md file here, or generate one with
                    the agent.
                  </PanelEmptyState>
                </div>
              )}

              {available && status !== "error" && skills.length > 0 && (
                <ul
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className={`flex flex-col gap-1 rounded-lg ${
                    isDragOver ? "bg-secondary/60 ring-1 ring-accent-light" : ""
                  }`}
                >
                  {skills.map((skill) => {
                    const isPending = pendingUpdates[skill.name] ?? false;
                    return (
                    <li
                      key={skill.name}
                      data-testid={`user-skill-${skill.name}`}
                      className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-secondary/60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-medium text-text-primary">
                            /{skill.name}
                          </span>
                          {!skill.enabled && (
                            <span className="shrink-0 rounded bg-secondary px-1 py-0.5 text-[10px] text-text-muted">
                              Disabled
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-text-muted">{skill.description}</p>
                      </div>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={skill.enabled}
                        aria-label={skill.enabled ? `Disable ${skill.name}` : `Enable ${skill.name}`}
                        onClick={() => handleToggleEnabled(skill)}
                        disabled={isPending}
                        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                          skill.enabled ? "bg-accent-primary" : "bg-secondary"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 size-3 rounded-full bg-white transition-transform ${
                            skill.enabled ? "translate-x-3.5" : "translate-x-0.5"
                          }`}
                        />
                      </button>

                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <IconButton
                              tooltip="Skill options"
                              size="icon-sm"
                              variant="ghost"
                              className="text-text-muted hover:text-text-primary"
                              disabled={isPending}
                            >
                              <DotsThreeVertical size={16} weight="bold" />
                            </IconButton>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditForm(skill)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleExport(skill)}>
                            Export .md
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDeletingName(skill.name)}>
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}

        {view === "generate" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-text-muted">
              Describe a workflow and the agent will draft a skill for you to review and
              edit before saving.
            </p>
            {storeError && <InlineAlert variant="error">{storeError}</InlineAlert>}
            <div className="flex flex-col gap-1">
              <Label htmlFor="skill-generate-prompt">What should this skill do?</Label>
              <Textarea
                id="skill-generate-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. Always check contrast ratios and flag anything under AA."
                rows={4}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setView("list")}>
                Cancel
              </Button>
              <Button onClick={() => void handleGenerate()} disabled={!prompt.trim() || generating}>
                {generating ? "Generating…" : "Generate"}
              </Button>
            </div>
          </div>
        )}

        {view === "form" && (
          <div className="flex flex-col gap-3">
            {form.source === "generated" && !form.originalName && (
              <p className="text-xs text-text-muted">
                Review the generated skill below, then save it.
              </p>
            )}
            {formError && <InlineAlert variant="error">{formError}</InlineAlert>}
            <div className="flex flex-col gap-1">
              <Label htmlFor="skill-form-name">Name</Label>
              <Input
                id="skill-form-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. contrast-check"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="skill-form-description">Description</Label>
              <Input
                id="skill-form-description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="One line describing when this skill applies"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="skill-form-body">Instructions</Label>
              <Textarea
                id="skill-form-body"
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="Markdown instructions the agent should follow"
                rows={8}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setView("list");
                  setForm(EMPTY_FORM);
                  setFormError(null);
                }}
              >
                Cancel
              </Button>
              <Button onClick={() => void handleSaveForm()} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}

        <AlertDialog
          open={deletingSkill != null}
          onOpenChange={(next) => !next && setDeletingName(null)}
        >
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{deletingSkill?.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the skill and it will no longer be invocable with
                /{deletingSkill?.name}. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  if (deletingSkill) void remove(deletingSkill.name);
                  setDeletingName(null);
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
