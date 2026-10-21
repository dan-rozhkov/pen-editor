import { useState, type KeyboardEvent } from "react";
import { KeyIcon, XIcon } from "@phosphor-icons/react";
import { SECRET_NAME_PATTERN } from "@sideform/browser-agent/agent/execute";
import { MIN_SECRET_LENGTH, useBrowseSecretStore } from "@/store/browseSecretStore";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const NO_SECRETS: { name: string; value: string }[] = [];
const DEFAULT_NAME = "password";
const NAME_RULE = "Name: 1-40 letters, digits, - or _.";

// Keep password managers out: this is not a login the browser should save or fill.
const NO_MANAGER = { "data-1p-ignore": true, "data-lpignore": "true", "data-form-type": "other" } as const;

/**
 * Key button in the composer: the user's passwords for the browser agent.
 * The model only sees `{{secret:<name>}}` and types it; the value lives in
 * browseSecretStore (in memory). The value is never rendered here: the list
 * shows names only. There is deliberately no `<form>` (a form with a password
 * field invites "save password?"); Enter on an input submits.
 */
export function BrowseSecretsButton({ chatId }: { chatId: string }) {
  // Subscribes to the entries but renders only `name`.
  const secrets = useBrowseSecretStore((s) => s.byChat[chatId] ?? NO_SECRETS);
  const [name, setName] = useState(DEFAULT_NAME);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const nameInvalid = name !== "" && !SECRET_NAME_PATTERN.test(name);

  const submit = () => {
    if (name === "" || nameInvalid || value === "") return;
    const result = useBrowseSecretStore.getState().set(chatId, name, value);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setValue("");
    // The next secret needs a new name.
    if (name === DEFAULT_NAME) setName("");
  };

  const onEnter = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit();
  };

  return (
    <Popover
      onOpenChange={(open) => {
        // A half-typed password must not outlive the popover.
        if (!open) {
          setValue("");
          setError(null);
        }
      }}
    >
      <PopoverTrigger
        render={
          <IconButton
            type="button"
            variant="ghost"
            size="icon"
            tooltip="Passwords for the browser"
            aria-label="Passwords for the browser"
            className="relative size-[30px] text-text-muted hover:bg-secondary"
          >
            <KeyIcon size={18} weight="light" />
            {secrets.length > 0 && (
              <span
                data-testid="browse-secrets-count"
                className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-accent-primary text-[9px] leading-none text-white"
              >
                {secrets.length}
              </span>
            )}
          </IconButton>
        }
      />
      <PopoverContent side="top" align="start" className="w-72 gap-3">
        {secrets.length > 0 && (
          <ul className="flex flex-col gap-1" aria-label="Saved passwords">
            {secrets.map((secret) => (
              <li key={secret.name} className="flex items-center justify-between gap-2">
                <code className="min-w-0 truncate font-mono text-xs text-text-primary">{`{{secret:${secret.name}}}`}</code>
                <IconButton
                  type="button"
                  variant="ghost"
                  size="icon"
                  tooltip={`Remove ${secret.name}`}
                  onClick={() => useBrowseSecretStore.getState().remove(chatId, secret.name)}
                  className="size-6 shrink-0 text-text-muted hover:bg-secondary"
                >
                  <XIcon size={12} weight="light" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Name
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              onKeyDown={onEnter}
              aria-invalid={nameInvalid}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              {...NO_MANAGER}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Password
            <Input
              type="password"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              onKeyDown={onEnter}
              autoComplete="new-password"
              {...NO_MANAGER}
            />
          </label>
          {(error || nameInvalid) && (
            <p role="alert" className="text-xs text-destructive">
              {error ?? NAME_RULE}
            </p>
          )}
          <Button type="button" size="sm" onClick={submit} disabled={name === "" || nameInvalid || value === ""}>
            Add
          </Button>
        </div>
        <p className="text-[11px] leading-snug text-text-muted">
          {`The agent types it into the page as {{secret:name}} and never sees it. Kept in memory until you reload the page. Passwords need at least ${MIN_SECRET_LENGTH} characters.`}
        </p>
      </PopoverContent>
    </Popover>
  );
}
