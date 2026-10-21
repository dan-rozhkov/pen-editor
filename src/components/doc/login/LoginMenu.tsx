import { forwardRef, useEffect, useMemo, useState } from "react";
import { KeyIcon, PlusIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { createRowLabel, filterLogins, loadSavedLogins, loginHost, type SavedLogin } from "@/lib/docs/savedLogins";
import { MENU_SURFACE } from "../ui/menuSurface";
import { useListNav, type SuggestionMenuHandle } from "../ui/useListNav";

export type LoginMenuPick = { kind: "login"; login: SavedLogin } | { kind: "create"; query: string };

export type LoginMenuHandle = SuggestionMenuHandle;

interface Props {
  query: string;
  command: (pick: LoginMenuPick) => void;
}

type Load = { state: "loading" } | { state: "error"; error: string } | { state: "ready"; entries: SavedLogin[] };

/** The popover under `@`: saved logins matching the query, then always a "Create new login" row. */
export const LoginMenu = forwardRef<LoginMenuHandle, Props>(function LoginMenu({ query, command }, ref) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  // The menu mounts once per open, so this refetches on each open.
  useEffect(() => {
    let live = true;
    void loadSavedLogins().then((result) => {
      if (live) setLoad(result.ok ? { state: "ready", entries: result.entries } : { state: "error", error: result.error });
    });
    return () => {
      live = false;
    };
  }, []);

  const matches = useMemo(() => (load.state === "ready" ? filterLogins(load.entries, query) : []), [load, query]);
  const picks = useMemo<LoginMenuPick[]>(
    () => [...matches.map((login): LoginMenuPick => ({ kind: "login", login })), { kind: "create", query }],
    [matches, query],
  );

  // The keys belong to the editor unless there is something to choose: logins, or a typed query once the list is in.
  const picking = load.state !== "loading" && (matches.length > 0 || query !== "");
  const { selected, setSelected, listRef } = useListNav(ref, { items: picks, onPick: command, resetKey: matches, picking });

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Saved logins"
      className={cn(MENU_SURFACE, "max-h-80 w-64 overflow-y-auto p-1")}
      onMouseDown={(event) => event.preventDefault()}
    >
      {load.state === "loading" && <div className="px-2 py-1.5 text-xs text-popover-foreground/60">Loading…</div>}
      {load.state === "error" && (
        <div role="alert" className="px-2 py-1.5 text-xs text-destructive">
          {load.error}
        </div>
      )}
      {picks.map((pick, index) => (
        <div
          key={pick.kind === "login" ? pick.login.id : "create"}
          role="option"
          aria-selected={index === selected}
          className={cn(
            "flex cursor-default items-center gap-2 rounded-md px-1.5 py-1 aria-selected:bg-accent aria-selected:text-accent-foreground",
            pick.kind === "create" && index > 0 && "mt-1",
          )}
          onMouseMove={() => setSelected(index)}
          onClick={() => command(pick)}
        >
          <span className="bg-popover-foreground/10 flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4">
            {pick.kind === "create" ? <PlusIcon /> : pick.login.icon ? <img src={pick.login.icon} alt="" className="size-4 rounded-sm" /> : <KeyIcon />}
          </span>
          <span className="min-w-0">
            {pick.kind === "create" ? (
              <span className="block truncate text-xs font-medium">{createRowLabel(query)}</span>
            ) : (
              <>
                <span className="block truncate text-xs font-medium">{pick.login.username || pick.login.label}</span>
                <span className="block truncate text-[0.6875rem] text-popover-foreground/60">
                  {pick.login.label && pick.login.label !== pick.login.username ? `${pick.login.label} · ` : ""}
                  {loginHost(pick.login.origin)}
                </span>
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
});
