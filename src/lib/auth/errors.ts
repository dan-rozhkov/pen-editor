// Plain-language messages for the auth pages. Deliberately coarse: sign-in
// failures never say whether an account exists.
const LINK_ERRORS = new Set([
  "INVALID_TOKEN",
  "EXPIRED_TOKEN",
  "TOKEN_EXPIRED",
  "ATTEMPT_LIMIT_REACHED",
  "invalid_token",
  "expired_token",
]);

/** Message for the `?error=` the backend redirects back to /sign-in with. */
export function describeRedirectError(code: string): string {
  if (LINK_ERRORS.has(code)) {
    return "That link is invalid or has expired. Request a new one.";
  }
  if (code === "access_denied") return "Sign-in was cancelled.";
  // Only echo a short, boring code; the value comes from the URL.
  const safe = /^[A-Za-z0-9_.-]{1,64}$/.test(code) ? ` (${code})` : "";
  return `Sign-in failed${safe}. Try again.`;
}

interface AuthErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

/** Message for a failed sign-in / sign-up / reset call. */
export function describeActionError(error: AuthErrorLike | null | undefined): string {
  if (!error) return "Something went wrong. Try again.";
  if (error.code === "EMAIL_NOT_VERIFIED") {
    return "Verify your email address first. Check your inbox for the link.";
  }
  if (error.status === 429) return "Too many attempts. Wait a minute and try again.";
  if (error.code === "INVALID_TOKEN") {
    return "That reset link is invalid or has expired. Request a new one.";
  }
  if (error.code === "PASSWORD_TOO_SHORT") return "Password is too short.";
  if (error.code === "PASSWORD_TOO_LONG") return "Password is too long.";
  if (error.status === 401 || error.status === 400 || error.status === 403) {
    return "Incorrect email or password.";
  }
  return "Something went wrong. Try again.";
}
