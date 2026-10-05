import { appHref } from "@/lib/auth/paths";
import { cn } from "@/lib/utils";

export const LEGAL_LINKS = [
  { path: "/privacy", label: "Privacy" },
  { path: "/terms", label: "Terms" },
  { path: "/support", label: "Support" },
] as const;

/** Plain links (not router <Link>s) so they also render outside a Router. */
export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs", className)}>
      {LEGAL_LINKS.map(({ path, label }) => (
        <a key={path} href={appHref(path)} className="text-text-muted hover:underline">
          {label}
        </a>
      ))}
    </nav>
  );
}
