import type { ReactNode } from "react";

import { LegalLinks } from "@/components/legal/LegalLinks";
import { appHref } from "@/lib/auth/paths";

export const LEGAL_UPDATED = "5 October 2026";
export const ISSUES_URL = "https://github.com/dan-rozhkov/pen-editor-plugin/issues";

/** Document chrome for the public /privacy, /terms and /support pages. */
export function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-[100dvh] bg-surface-base px-4 py-10">
      <article className="mx-auto w-full max-w-[720px]">
        <a
          href={appHref("/")}
          className="mb-8 inline-block text-sm font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
        >
          Sideform
        </a>
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-text-primary">{title}</h1>
        <p className="mb-8 text-sm text-text-muted">Last updated: {LEGAL_UPDATED}</p>
        <div className="flex flex-col gap-4 text-sm leading-relaxed text-text-primary">{children}</div>
        <footer className="mt-12 border-t border-border-default pt-6">
          <LegalLinks />
        </footer>
      </article>
    </main>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="mt-4 text-base font-semibold text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5">{children}</ul>;
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent-primary underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

export function IntLink({ path, children }: { path: string; children: ReactNode }) {
  return (
    <a href={appHref(path)} className="text-accent-primary underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

export function Contact() {
  return (
    <Section title="Contact">
      <p>
        Contact us through our public issues page:{" "}
        <ExtLink href={ISSUES_URL}>{ISSUES_URL}</ExtLink>. Do not post private or sensitive details there.
      </p>
      <p>
        <strong>
          For privacy requests, open an issue titled &lsquo;Privacy request&rsquo; and we will reply with a private
          channel.
        </strong>
      </p>
    </Section>
  );
}
