import { forwardRef, useEffect, useMemo, useState } from "react";
import { KeyIcon, PlusIcon } from "@/components/icons";
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
      {load.state === "loading" && <div className="px-2.5 py-1.5 text-[13px] text-menu-muted-foreground">Loading…</div>}
      {load.state === "error" && (
        <div role="alert" className="px-2.5 py-1.5 text-[13px] text-destructive">
          {load.error}
        </div>
      )}
      {picks.map((pick, index) => (
        <div
          key={pick.kind === "login" ? pick.login.id : "create"}
          role="option"
          aria-selected={index === selected}
          className={cn(
            "text-menu-foreground flex cursor-default items-center gap-2.5 rounded-[10px] px-2 py-1.5 aria-selected:bg-menu-highlight aria-selected:text-menu-foreground",
            pick.kind === "create" && index > 0 && "mt-1",
          )}
          onMouseMove={() => setSelected(index)}
          onClick={() => command(pick)}
        >
          <span className="ring-menu-border bg-menu flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 [&_svg]:size-4">
            {pick.kind === "create" ? <PlusIcon /> : pick.login.icon ? <img src={pick.login.icon} alt="" className="size-4 rounded-sm" /> : <KeyIcon />}
          </span>
          <span className="min-w-0">
            {pick.kind === "create" ? (
              <span className="block truncate text-[13px] leading-5 font-medium">{createRowLabel(query)}</span>
            ) : (
              <>
                <span className="block truncate text-[13px] leading-5 font-medium">{pick.login.username || pick.login.label}</span>
                <span className="block truncate text-[11px] text-menu-muted-foreground">
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
