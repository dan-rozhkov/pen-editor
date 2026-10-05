import { useId, type ComponentProps, type ReactNode } from "react";

import { LegalLinks } from "@/components/legal/LegalLinks";
import { appHref } from "@/lib/auth/paths";
import { cn } from "@/lib/utils";

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary";

/** Centered page chrome shared by /sign-in, /consent and /account. */
export function AuthShell({
  title,
  children,
  wide,
}: {
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-surface-base px-4 py-10">
      <div
        className={cn(
          "w-full rounded-xl border border-border-default bg-surface-panel p-6 shadow-sm sm:p-8",
          wide ? "max-w-xl" : "max-w-sm",
        )}
      >
        <a
          href={appHref("/")}
          className={cn("mb-6 inline-block text-sm font-semibold text-text-primary", FOCUS)}
        >
          Sideform
        </a>
        <h1 className="mb-5 text-xl font-semibold tracking-tight text-text-primary">{title}</h1>
        {children}
        <LegalLinks className="mt-6" />
      </div>
    </main>
  );
}

export function TextField({
  label,
  hint,
  ...props
}: ComponentProps<"input"> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text-primary">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...props}
        // 16px: below that iOS Safari zooms the page on focus.
        className={cn(
          "h-10 w-full rounded-md border border-border-default bg-surface-panel px-3 text-base text-text-primary placeholder:text-text-disabled",
          FOCUS,
          props.className,
        )}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export function AuthButton({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "danger" }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        FOCUS,
        variant === "primary" && "bg-accent-primary text-white hover:opacity-90",
        variant === "secondary" &&
          "border border-border-default bg-surface-panel text-text-primary hover:bg-surface-hover",
        variant === "danger" && "bg-destructive/10 text-destructive hover:bg-destructive/20",
        className,
      )}
    />
  );
}

export function LinkButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "text-sm text-accent-primary underline-offset-2 hover:underline",
        FOCUS,
        className,
      )}
    />
  );
}

/** Errors are announced immediately (role=alert); notices politely. Both
 * regions stay mounted-empty-safe: callers render them only when non-null. */
export function FormMessage({
  kind,
  children,
}: {
  kind: "error" | "notice";
  children: ReactNode;
}) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md px-3 py-2 text-sm",
        kind === "error"
          ? "bg-destructive/10 text-destructive"
          : "bg-surface-elevated text-text-primary",
      )}
    >
      {children}
    </p>
  );
}

export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="my-4 flex items-center gap-3 text-xs text-text-muted" aria-hidden>
      <span className="h-px flex-1 bg-border-default" />
      {children}
      <span className="h-px flex-1 bg-border-default" />
    </div>
  );
}
