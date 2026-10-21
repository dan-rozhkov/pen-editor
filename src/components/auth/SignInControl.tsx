import { desktopAuth } from "@/lib/auth/desktopAuth";
import { signInHref, stripBase } from "@/lib/auth/paths";

/**
 * The signed-out "Sign in" action, shared by the account menu and the Settings
 * page. Desktop shell: the system browser. Web: /sign-in, in a NEW tab when
 * `newTab` (so an unsaved editor document is never navigated away from; the
 * session then reaches this tab through Better Auth's cross-tab sync), else in
 * this tab with a way back to the current page.
 */
export function SignInControl({ className, newTab }: { className: string; newTab?: boolean }) {
  const desktop = desktopAuth();
  if (desktop) {
    return (
      <button type="button" onClick={() => desktop.signIn()} className={className}>
        Sign in
      </button>
    );
  }
  const href = newTab ? signInHref("/account") : signInHref(stripBase(window.location.pathname));
  return (
    <a href={href} target={newTab ? "_blank" : undefined} rel={newTab ? "noopener" : undefined} className={className}>
      Sign in
    </a>
  );
}
