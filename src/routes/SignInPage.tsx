import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";

import {
  AuthButton,
  AuthShell,
  Divider,
  FormMessage,
  LinkButton,
  TextField,
} from "@/components/auth/authUi";
import { authClient } from "@/lib/auth/authClient";
import { useAuthConfig } from "@/lib/auth/authConfig";
import { describeActionError, describeRedirectError } from "@/lib/auth/errors";
import { appHref } from "@/lib/auth/paths";
import { safeNext } from "@/lib/auth/safeNext";
import { signOut, useSession } from "@/lib/auth/session";

type Mode = "magic" | "password" | "signup" | "forgot" | "reset";

const NEUTRAL_EMAIL_NOTICE = "If an account exists for that address, we sent an email. Check your inbox.";

// The reset token arrives as ?token=. Read it once and drop it from the address
// bar right away so analytics' pageleave event never records it.
function takeResetToken(params: URLSearchParams): string | null {
  const token = params.get("token");
  if (token) {
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
  return token;
}

export default function SignInPage() {
  const config = useAuthConfig();
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const redirectError = params.get("error");
  const [resetToken] = useState(() => takeResetToken(params));

  const [mode, setMode] = useState<Mode>(resetToken ? "reset" : "magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The oauth-provider plugin sends an agent's authorization request here with
  // a signed query (`sig`). Everything that leaves this page (magic link,
  // verification email, Google) must come back to THIS url so the signed query
  // survives and the flow can resume; a plain visit goes to `next`.
  const oauthPending = params.has("sig");
  const absoluteNext = oauthPending
    ? `${window.location.origin}${window.location.pathname}${window.location.search}`
    : `${window.location.origin}${appHref(next)}`;

  // Resume the OAuth flow with the existing session and follow the redirect
  // the plugin hands back (`url` / `redirect_uri`).
  async function continueOAuth(): Promise<boolean> {
    try {
      const res = await authClient.oauth2.continue({});
      const data = res?.data as { url?: string; redirect_uri?: string } | null | undefined;
      const target = data?.url ?? data?.redirect_uri;
      if (res?.error || !target) return false;
      window.location.assign(target);
      return true;
    } catch {
      return false;
    }
  }

  // After a successful credential sign-in: a redirect carried by the result
  // wins; otherwise continue a pending OAuth request; otherwise go to `next`.
  async function afterSignIn(result: unknown) {
    const data = (result as { data?: { redirect?: unknown; url?: unknown } } | undefined)?.data;
    if (typeof data?.url === "string") {
      window.location.assign(data.url);
      return;
    }
    if (oauthPending && (await continueOAuth())) return;
    navigate(next);
  }

  // Returning from a magic link / verification / Google with the signed query
  // still on the URL and a session now in place: resume the flow at once.
  const hasUser = Boolean(session.data?.user);
  const autoContinued = useRef(false);
  useEffect(() => {
    if (!oauthPending || !hasUser || config?.enabled !== true || autoContinued.current) return;
    autoContinued.current = true;
    void continueOAuth();
  }, [oauthPending, hasUser, config?.enabled]);

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setNotice(null);
  }

  async function run(
    action: () => Promise<{ error?: unknown; data?: unknown } | undefined>,
    onDone: (result?: unknown) => void,
  ) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (result?.error) {
        setError(describeActionError(result.error as Parameters<typeof describeActionError>[0]));
      } else {
        onDone(result);
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const errorCallbackURL = `${window.location.origin}${appHref("/sign-in")}`;
    if (mode === "magic") {
      void run(
        () => authClient.signIn.magicLink({ email, callbackURL: absoluteNext, errorCallbackURL }),
        () => setNotice(NEUTRAL_EMAIL_NOTICE),
      );
    } else if (mode === "password") {
      void run(
        () => authClient.signIn.email({ email, password, callbackURL: absoluteNext }),
        (result) => void afterSignIn(result),
      );
    } else if (mode === "signup") {
      void run(
        () =>
          authClient.signUp.email({
            email,
            password,
            name: name.trim() || email.split("@")[0],
            callbackURL: absoluteNext,
          }),
        () => setNotice("If this address can be registered, we sent a verification email. Check your inbox."),
      );
    } else if (mode === "forgot") {
      void run(
        () =>
          authClient.requestPasswordReset({
            email,
            redirectTo: `${window.location.origin}${appHref("/sign-in")}`,
          }),
        () => setNotice(NEUTRAL_EMAIL_NOTICE),
      );
    } else if (mode === "reset" && resetToken) {
      void run(
        () => authClient.resetPassword({ newPassword: password, token: resetToken }),
        () => {
          setPassword("");
          setMode("password");
          setNotice("Password updated. Sign in with your new password.");
        },
      );
    }
  }

  if (config === null || session.isPending) {
    return (
      <AuthShell title="Sign in">
        <p role="status" className="text-sm text-text-muted">
          Loading…
        </p>
      </AuthShell>
    );
  }

  if (!config.enabled) {
    return (
      <AuthShell title="Sign in">
        <p className="text-sm text-text-muted">Accounts are not available right now.</p>
        <a href={appHref("/")} className="mt-4 inline-block text-sm text-accent-primary hover:underline">
          Back to Sideform
        </a>
      </AuthShell>
    );
  }

  if (session.data?.user) {
    return (
      <AuthShell title="You are signed in">
        <p className="mb-4 text-sm text-text-muted">
          Signed in as <span className="text-text-primary">{session.data.user.email}</span>.
        </p>
        <div className="flex flex-wrap gap-2">
          <AuthButton
            onClick={() => {
              if (oauthPending) void continueOAuth().then((ok) => !ok && navigate(next));
              else navigate(next);
            }}
          >
            Continue
          </AuthButton>
          <AuthButton variant="secondary" onClick={() => void signOut()}>
            Sign out
          </AuthButton>
        </div>
      </AuthShell>
    );
  }

  const showEmail = config.emailEnabled;
  const showGoogle = config.google;
  const needsPassword = mode === "password" || mode === "signup" || mode === "reset";
  const titles: Record<Mode, string> = {
    magic: "Sign in to Sideform",
    password: "Sign in with password",
    signup: "Create an account",
    forgot: "Reset your password",
    reset: "Choose a new password",
  };
  const submitLabels: Record<Mode, string> = {
    magic: "Email me a link",
    password: "Sign in",
    signup: "Create account",
    forgot: "Email me a reset link",
    reset: "Update password",
  };

  return (
    <AuthShell title={titles[mode]}>
      <div className="flex flex-col gap-3">
        {redirectError && <FormMessage kind="error">{describeRedirectError(redirectError)}</FormMessage>}
        {!showEmail && !showGoogle && (
          <p className="text-sm text-text-muted">No sign-in methods are available right now.</p>
        )}

        {showGoogle && mode !== "reset" && (
          <AuthButton
            variant="secondary"
            disabled={pending}
            onClick={() =>
              void run(
                () => authClient.signIn.social({ provider: "google", callbackURL: absoluteNext }),
                () => undefined,
              )
            }
          >
            Continue with Google
          </AuthButton>
        )}

        {showGoogle && showEmail && mode !== "reset" && <Divider>or</Divider>}

        {showEmail && (
          <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-busy={pending}>
            {mode === "signup" && (
              <TextField
                label="Name"
                name="name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
            {mode !== "reset" && (
              <TextField
                label="Email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
            {needsPassword && (
              <TextField
                label={mode === "reset" ? "New password" : "Password"}
                name="password"
                type="password"
                autoComplete={mode === "password" ? "current-password" : "new-password"}
                required
                minLength={mode === "password" ? undefined : 8}
                hint={mode === "password" ? undefined : "At least 8 characters."}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
            {error && <FormMessage kind="error">{error}</FormMessage>}
            {notice && <FormMessage kind="notice">{notice}</FormMessage>}
            <AuthButton type="submit" disabled={pending}>
              {pending ? "Please wait…" : submitLabels[mode]}
            </AuthButton>

            <div className="flex flex-col items-start gap-1.5">
              {mode === "magic" && (
                <LinkButton onClick={() => switchMode("password")}>Use password</LinkButton>
              )}
              {mode === "password" && (
                <>
                  <LinkButton onClick={() => switchMode("magic")}>Email me a link instead</LinkButton>
                  <LinkButton onClick={() => switchMode("forgot")}>Forgot password?</LinkButton>
                </>
              )}
              {(mode === "magic" || mode === "password") && (
                <LinkButton onClick={() => switchMode("signup")}>Create an account</LinkButton>
              )}
              {(mode === "signup" || mode === "forgot" || mode === "reset") && (
                <LinkButton onClick={() => switchMode("password")}>Back to sign in</LinkButton>
              )}
            </div>
          </form>
        )}

        {!showEmail && error && <FormMessage kind="error">{error}</FormMessage>}
      </div>
    </AuthShell>
  );
}
