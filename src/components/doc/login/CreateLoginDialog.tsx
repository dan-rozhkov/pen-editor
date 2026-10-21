import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Editor, Range } from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addSavedLogin, LOGIN_CANCELLED, resolveLoginHost } from "@/lib/docs/savedLogins";
import { CREATE_LOGIN_EVENT, insertLoginChip, type CreateLoginRequest } from "./LoginMention";

export interface CreatedLogin {
  id: string;
  username: string;
  host: string;
}

interface FormProps {
  initialUsername: string;
  onDone: (login: CreatedLogin) => void;
  onCancel: () => void;
  /** True from the click on Save until the desktop answered: the dialog must not close meanwhile. */
  onBusy?: (busy: boolean) => void;
}

type Failure = { message: string; existingId?: string };

/** Fields of the "Create login" dialog. Saves through the desktop bridge; the password goes nowhere else. */
export function CreateLoginForm({ initialUsername, onDone, onCancel, onBusy }: FormProps) {
  const [site, setSite] = useState("");
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [missing, setMissing] = useState<{ site?: boolean; username?: boolean; password?: boolean }>({});
  const [saving, setSaving] = useState(false);

  // A save can finish after the dialog closed; the form is gone by then and must not report a login.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    onBusy?.(saving);
  }, [saving, onBusy]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const fields = { site: site.trim(), username: username.trim(), password, label: label.trim() };
    const nextMissing = { site: !fields.site, username: !fields.username, password: !fields.password };
    setMissing(nextMissing);
    if (nextMissing.site || nextMissing.username || nextMissing.password) return;
    setFailure(null);
    setSaving(true);
    const result = await addSavedLogin({ site: fields.site, username: fields.username, password: fields.password, ...(fields.label ? { label: fields.label } : {}) });
    if (result.ok) {
      const host = await resolveLoginHost(result.id, fields.site);
      if (alive.current) onDone({ id: result.id, username: fields.username, host });
      return;
    }
    if (!alive.current) return;
    setSaving(false);
    // The user declined the desktop's confirmation: nothing went wrong, the form just stays as it was.
    if (result.error === LOGIN_CANCELLED) return;
    setFailure({ message: result.error, existingId: result.exists ? result.id : undefined });
  };

  const chooseExisting = async () => {
    const id = failure?.existingId;
    if (!id || saving) return;
    setSaving(true);
    const host = await resolveLoginHost(id, site.trim());
    if (alive.current) onDone({ id, username: username.trim(), host });
  };

  return (
    <form className="grid gap-4" onSubmit={(event) => void submit(event)} noValidate>
      <DialogHeader>
        <DialogTitle>Create login</DialogTitle>
        <DialogDescription>Saved in the desktop app and inserted here as a mention. The password is not stored in the document.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="login-site">Site URL</Label>
          <Input id="login-site" autoFocus value={site} placeholder="https://example.com" autoComplete="off" spellCheck={false} aria-invalid={missing.site || undefined} aria-required onChange={(e) => setSite(e.target.value)} />
          {missing.site && <p className="text-destructive text-xs">Enter the site URL.</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="login-username">Username</Label>
          <Input id="login-username" value={username} autoComplete="off" spellCheck={false} aria-invalid={missing.username || undefined} aria-required onChange={(e) => setUsername(e.target.value)} />
          {missing.username && <p className="text-destructive text-xs">Enter the username.</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="login-password">Password</Label>
          <Input id="login-password" type="password" value={password} autoComplete="new-password" aria-invalid={missing.password || undefined} aria-required onChange={(e) => setPassword(e.target.value)} />
          {missing.password && <p className="text-destructive text-xs">Enter the password.</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="login-label">Label (optional)</Label>
          <Input id="login-label" value={label} autoComplete="off" onChange={(e) => setLabel(e.target.value)} />
        </div>
      </div>
      {failure && (
        <div role="alert" className="text-destructive flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0">{failure.message}</span>
          {failure.existingId && (
            <Button type="button" size="sm" variant="outline" onClick={() => void chooseExisting()}>
              Use existing
            </Button>
          )}
        </div>
      )}
      <DialogFooter>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Opened by the `@` menu's create row; on success a chip replaces the typed "@query". */
export function CreateLoginDialog({ editor }: { editor: Editor }) {
  // `request` outlives `open` until the close animation ends, so the form does not vanish mid-fade.
  const [request, setRequest] = useState<(CreateLoginRequest & { key: number }) | null>(null);
  const [open, setOpen] = useState(false);
  const range = useRef<Range | null>(null);
  const busy = useRef(false);
  const opened = useRef(0);

  useEffect(() => {
    const dom = editor.view.dom;
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<CreateLoginRequest>).detail;
      range.current = detail.range;
      opened.current += 1;
      setRequest({ ...detail, key: opened.current });
      setOpen(true);
    };
    // The saved range follows every edit made while the dialog is open (an agent write, a collaborator).
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      const saved = range.current;
      if (!saved || !transaction.docChanged) return;
      const from = transaction.mapping.mapResult(saved.from, 1);
      const to = transaction.mapping.mapResult(saved.to, -1);
      range.current = (from.deleted && to.deleted) || from.pos > to.pos ? null : { from: from.pos, to: to.pos };
    };
    dom.addEventListener(CREATE_LOGIN_EVENT, onOpen);
    editor.on("transaction", onTransaction);
    return () => {
      dom.removeEventListener(CREATE_LOGIN_EVENT, onOpen);
      editor.off("transaction", onTransaction);
    };
  }, [editor]);

  const close = () => {
    if (busy.current) return;
    setOpen(false);
    editor.commands.focus();
  };

  const done = (login: CreatedLogin) => {
    // The chip replaces the typed text while it still exists; otherwise it goes at the caret.
    const at = editor.state.selection.from;
    insertLoginChip(editor, range.current ?? { from: at, to: at }, login);
    range.current = null;
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()} onOpenChangeComplete={(next) => !next && setRequest(null)}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        {request && (
          <CreateLoginForm
            key={request.key}
            initialUsername={request.query.trim()}
            onDone={done}
            onCancel={close}
            onBusy={(value) => void (busy.current = value)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
