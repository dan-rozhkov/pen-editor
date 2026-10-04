import { cn } from "@/lib/utils";
import { appHref, signInHref, stripBase } from "@/lib/auth/paths";
import { signOut, useSession } from "@/lib/auth/session";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { AuthMenuVariant } from "./AuthMenu";

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary";

export default function AuthMenuInner({ variant }: { variant: AuthMenuVariant }) {
  const { data, isPending } = useSession();
  if (isPending) return null;

  const user = data?.user;
  if (!user) {
    // Editor: new tab, so an unsaved document is never navigated away from;
    // the session then reaches this tab through Better Auth's cross-tab sync.
    const inEditor = variant === "toolbar";
    const href = inEditor ? signInHref("/account") : signInHref(stripBase(window.location.pathname));
    return (
      <a
        href={href}
        target={inEditor ? "_blank" : undefined}
        rel={inEditor ? "noopener" : undefined}
        className={cn(
          "inline-flex shrink-0 items-center rounded-full font-medium transition-colors",
          FOCUS,
          variant === "showcase"
            ? "bg-surface-elevated px-4 py-2 text-sm text-text-muted hover:bg-surface-hover hover:text-text-primary"
            : "h-6 px-2.5 text-xs text-text-primary hover:bg-surface-hover",
        )}
      >
        Sign in
      </a>
    );
  }

  const label = user.name || user.email;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Account menu for ${label}`}
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-primary/10 text-xs font-semibold text-accent-primary",
              FOCUS,
            )}
          />
        }
      >
        {user.image ? (
          <img src={user.image} alt="" className="size-full object-cover" />
        ) : (
          <span aria-hidden>{label.slice(0, 1).toUpperCase()}</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="min-w-44">
        <div className="truncate px-2 py-1.5 text-xs text-text-muted">{user.email}</div>
        <DropdownMenuItem onClick={() => window.location.assign(appHref("/account"))}>
          Account
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void signOut()}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
