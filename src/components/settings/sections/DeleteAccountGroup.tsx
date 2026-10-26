import { useState } from "react";

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
import { Input } from "@/components/ui/input";
import { JSON_HEADERS, requestJson } from "@/lib/apiJson";
import { signOut, useSession } from "@/lib/auth/session";
import { announceSessionChange, refetchSession } from "@/lib/auth/sessionChannel";

import { SettingsGroup } from "../SettingsSection";

// The backend answers with codes, never text (routes/auth.ts).
const GENERIC_ERROR = "Could not delete the account. Try again.";
const ERROR_MESSAGES: Record<string, string> = {
  confirm_email_mismatch: "That email does not match your account.",
  sign_in_required: "Your session has ended. Sign in again, then retry.",
  auth_disabled: "Accounts are turned off on this server.",
  delete_failed: GENERIC_ERROR,
};

function emailsMatch(typed: string, email: string): boolean {
  return typed.trim().toLowerCase() === email.trim().toLowerCase() && email.length > 0;
}

function DeleteAccount({ email, onDeleted }: { email: string; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await requestJson<unknown>("/api/account/delete", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ confirmEmail: typed.trim() }),
    });
    if (!res.ok) {
      // requestJson puts the backend's error code in `error` (or "Request failed (n)" / a network message).
      setError(res.error in ERROR_MESSAGES ? ERROR_MESSAGES[res.error] : GENERIC_ERROR);
      setBusy(false);
      return;
    }
    onDeleted();
    try {
      await signOut();
    } catch {
      // The account is gone either way; the re-resolve below settles the session.
    }
    // The server already dropped the session cookie. Make this view and the
    // others re-read the session so authState turns signed-out even if
    // signOut() failed, instead of staying "signed in" as a deleted user.
    refetchSession();
    announceSessionChange();
    setBusy(false);
  }

  function onOpenChange(next: boolean) {
    // A request in flight must finish: closing would hide its result.
    if (busy) return;
    setOpen(next);
    if (!next) {
      setTyped("");
      setError(null);
    }
  }

  const canDelete = !busy && emailsMatch(typed, email);
  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Delete account
      </Button>
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes your account and its data on our servers. Docs and workflows in this browser
              are not removed. Export them first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (canDelete) void submit();
            }}
          >
            <label className="text-xs text-text-primary" htmlFor="delete-account-email">
              Type {email} to confirm
            </label>
            <Input
              id="delete-account-email"
              type="email"
              autoComplete="off"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </form>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={!canDelete} onClick={() => void submit()}>
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Lazy: pulls in the auth client, so it mounts only when accounts are on. */
export default function DeleteAccountGroup() {
  const { data } = useSession();
  const [deleted, setDeleted] = useState(false);
  const email = data?.user?.email;
  if (deleted) {
    return (
      <SettingsGroup
        title="Account deleted"
        description="Your account and its server data are gone. Docs and workflows in this browser were not removed."
      />
    );
  }
  if (!email) return null;
  return (
    <SettingsGroup inline title="Delete account" description="Remove your account and its server-side data.">
      <DeleteAccount email={email} onDeleted={() => setDeleted(true)} />
    </SettingsGroup>
  );
}
