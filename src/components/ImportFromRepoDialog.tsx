import { useState } from "react";
import { useVariableStore } from "@/store/variableStore";
import { planRepoImport, type RepoImportPlan } from "@/lib/repoImport/planRepoImport";
import { fetchRepoTokens } from "@/lib/repoImport/fetchRepoTokens";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

const CATEGORY_LABELS = [
  ["colors", "Colors"],
  ["spacing", "Spacing"],
  ["borderRadius", "Radius"],
  ["fontFamily", "Font families"],
  ["themeAliases", "Theme aliases"],
] as const;

type Step =
  | { kind: "input"; error?: string }
  | { kind: "loading" }
  | { kind: "preview"; repo: string; plan: Extract<RepoImportPlan, { ok: true }>; briefNotes: string[] };

/** Variables panel: read a GitHub repo's design tokens, preview, then apply in one undo step. */
export function ImportFromRepoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [repo, setRepo] = useState("");
  const [step, setStep] = useState<Step>({ kind: "input" });

  const close = (next: boolean): void => {
    onOpenChange(next);
    if (!next) setStep({ kind: "input" });
  };

  const load = async (): Promise<void> => {
    setStep({ kind: "loading" });
    const result = await fetchRepoTokens(repo);
    if (!result.ok) {
      setStep({ kind: "input", error: result.error });
      return;
    }
    const { variables, collections } = useVariableStore.getState();
    const plan = planRepoImport(result.tokens, variables, collections);
    if (!plan.ok) {
      setStep({ kind: "input", error: plan.error });
      return;
    }
    setStep({ kind: "preview", repo: result.repo, plan, briefNotes: result.briefNotes });
  };

  const apply = (): void => {
    if (step.kind !== "preview") return;
    // Re-plan on the live store so a change made while the preview was open is not lost.
    const { variables, collections } = useVariableStore.getState();
    const fresh = planRepoImport(step.plan.preview.tokens, variables, collections);
    if (!fresh.ok) {
      setStep({ kind: "input", error: fresh.error });
      return;
    }
    fresh.apply();
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import from repo</DialogTitle>
          <DialogDescription>
            Reads colors, spacing, radius and fonts from a public GitHub repository into a Primitives collection, plus Theme aliases for names like background and primary.
          </DialogDescription>
        </DialogHeader>

        {step.kind !== "preview" && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void load();
            }}
          >
            <Input
              aria-label="Repository"
              placeholder="owner/repo"
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              disabled={step.kind === "loading"}
            />
            {step.kind === "input" && step.error && (
              <p role="alert" className="text-xs text-destructive">{step.error}</p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={step.kind === "loading" || repo.trim() === ""}>
                {step.kind === "loading" ? "Reading…" : "Read tokens"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step.kind === "preview" && (
          <div className="flex flex-col gap-3 text-xs">
            <p className="text-text-muted">{step.repo}</p>
            <ul aria-label="Tokens to import" className="flex flex-col gap-0.5">
              {CATEGORY_LABELS.map(([key, label]) => (
                <li key={key} className="flex justify-between">
                  <span>{label}</span>
                  <span>{step.plan.preview.conversion.counts[key]}</span>
                </li>
              ))}
            </ul>
            <p>
              {step.plan.preview.createCount} new, {step.plan.preview.updateCount} updated.
            </p>
            {step.plan.preview.overwrites.length > 0 && (
              <p role="status">
                Overwrites {step.plan.preview.overwrites.length} existing: {step.plan.preview.overwrites.slice(0, 6).join(", ")}
                {step.plan.preview.overwrites.length > 6 ? "…" : ""}
              </p>
            )}
            {step.plan.preview.skipped.length > 0 && (
              <div role="status">
                <p>Skipped {step.plan.preview.skipped.length}:</p>
                <ul className="list-disc pl-4 text-text-muted">
                  {step.plan.preview.skipped.slice(0, 8).map((s) => (
                    <li key={s.name}>{`${s.name}: ${s.reason}`}</li>
                  ))}
                </ul>
              </div>
            )}
            {[...step.plan.preview.conversion.notes, ...step.briefNotes].length > 0 && (
              <ul aria-label="Notes" className="list-disc pl-4 text-text-muted">
                {[...step.plan.preview.conversion.notes, ...step.briefNotes].slice(0, 8).map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep({ kind: "input" })}>Back</Button>
              <Button onClick={apply}>Import</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
