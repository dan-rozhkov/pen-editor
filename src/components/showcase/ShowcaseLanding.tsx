import { useEffect, useState } from "react";
import { Link } from "react-router";

import { AuthMenu } from "@/components/auth/AuthMenu";
import { SideformLockup } from "@/components/brand/SideformLogo";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { ShowcaseAgentComposer } from "@/components/showcase/ShowcaseAgentComposer";
import { LiquidGradient } from "@/components/showcase/landing/LiquidGradient";
import { RevealBlock, RevealText, Words } from "@/components/showcase/landing/Reveal";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/*
 * The landing is a 1:1 reproduction of the free Framer template "Signale"
 * (https://try-signall.framer.website/, by Berci Hazman) with Sideform content.
 * Layout, type scale, colours, the Liquid Gradient shader and the motion follow
 * the template; the copy is Sideform's own.
 */

export const PLUGIN_URL = "https://github.com/dan-rozhkov/pen-editor-plugin#setup";

// The macOS build of the desktop shell (../pen-editor-desktop) is published as
// a GitHub release asset. "/releases/latest" always resolves to the newest one,
// so this URL survives every desktop release untouched.
export const DESKTOP_DOWNLOAD_URL =
  "https://github.com/dan-rozhkov/pen-editor-desktop/releases/latest";

const EDITOR_SHOT = `${import.meta.env.BASE_URL}landing/sideform-editor-dark`;

const SOURCE_URL = "https://github.com/dan-rozhkov/pen-editor";

const ORANGE = "#ff4000";
const PALE = "#c0d5d0";
const BLUE = "#3c50a5";

const NAV_LINKS = [
  { href: "#apps", label: "Apps" },
  { href: "#use-cases", label: "Workflows" },
  { href: "#gallery", label: "Showcase" },
  { href: "#faq", label: "FAQ" },
] as const;

const DETAILS = [
  { label: "Desktop app", value: "macOS" },
  { label: "In the browser", value: "No install" },
  { label: "Your own agent", value: "Via MCP" },
] as const;

const STATS = [
  { value: "3", label: "Apps" },
  { value: "1", label: "Agent" },
  { value: "0", label: "Installs to try" },
  { value: "MCP", label: "For your own agent" },
] as const;

const APPS: { name: string; text: string; color: string }[] = [
  {
    name: "Browser",
    text: "The agent opens real sites, clicks through flows, collects references and checks your staging build. You watch every step in a tab.",
    color: ORANGE,
  },
  {
    name: "Canvas",
    text: "Screens appear as editable frames next to each other. Compare directions, change a detail and ask for one more option.",
    color: PALE,
  },
  {
    name: "Docs",
    text: "Specs, PRDs, design notes and bug reports in a Notion-style editor. The agent links them to the frames they describe.",
    color: BLUE,
  },
];

const ROLES: { label: string; heading: string; prompt: string; steps: [string, string, string] }[] = [
  {
    label: "For designers",
    heading: "Designers",
    prompt: "“Find onboarding references on Mobbin, design ours in our style and write down the decisions.”",
    steps: ["Saves references", "Designs 3 screens", "Writes design notes"],
  },
  {
    label: "For product builders",
    heading: "Product builders",
    prompt: "“Compare competitor pricing pages, mock up ours and draft a one-page PRD.”",
    steps: ["Compares competitors", "Mocks up the page", "Drafts the PRD"],
  },
  {
    label: "For QA testers",
    heading: "QA testers",
    prompt: "“Test sign-up on staging, mark what breaks and file a bug report.”",
    steps: ["Runs the flow", "Marks failures", "Files the bug report"],
  },
];

const STEP_APPS = ["Browser", "Canvas", "Docs"] as const;

const FAQ: { question: string; answer: React.ReactNode }[] = [
  {
    question: "What is the difference between the Mac app and the browser version?",
    answer:
      "The browser version gives you the canvas and the agent with no install, which is enough to try a concept. The Mac app adds the browser agent, tabs for docs and traces, and saves your work on your computer.",
  },
  {
    question: "Does the agent really use a browser?",
    answer:
      "Yes. In the Mac app the agent opens sites in a tab, clicks, types and reads pages, and you see every step. Each run keeps a trace you can replay. Sites that need an account use your own sign-in.",
  },
  {
    question: "Can I use the agent I already work with?",
    answer: (
      <>
        Yes. The desktop app connects to external agents, such as Claude Code, through MCP. Your agent then works on
        the same canvas.{" "}
        <a href={PLUGIN_URL} target="_blank" rel="noreferrer">
          Read the setup guide.
        </a>
      </>
    ),
  },
  {
    question: "Where does Sideform fit if I already use Figma and Notion?",
    answer:
      "Use Sideform for the early, fast part: research, first concepts and the first write-up, done by one agent. Keep Figma and Notion wherever they fit your team.",
  },
  {
    question: "Are the screens production-ready code?",
    answer:
      "They are HTML prototypes for exploring a direction. Review the result and adapt it to your application before you ship it.",
  },
];

const RUNS_ON = [
  { name: "Mac app", what: "Full workspace", where: "macOS", action: "download" },
  { name: "Browser", what: "Canvas + agent", where: "No install", action: "open" },
  { name: "Your agent", what: "Same canvas", where: "MCP", action: "setup" },
] as const;

type DotKind = "cluster" | "bullet";

// Braille-style dot glyphs the template uses as card icons and bullets.
const DOT_CELLS: Record<DotKind, [number, number][]> = {
  cluster: [[0, 1], [0, 2], [1, 0], [1, 1]],
  bullet: [[0, 2], [1, 1], [1, 2]],
};

function Dots({ kind, color }: { kind: DotKind; color: string }) {
  return (
    <svg className="sf-dots" width="16" height="24" viewBox="0 0 16 24" aria-hidden="true" focusable="false">
      {DOT_CELLS[kind].map(([column, row]) => (
        <circle key={`${column}-${row}`} cx={5 + column * 6} cy={7 + row * 5} r="1.4" fill={color} />
      ))}
    </svg>
  );
}

function useNavState() {
  const [hidden, setHidden] = useState(false);
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    function onScroll() {
      const y = window.scrollY;
      setHidden(y > lastY && y > 120);
      setSolid(y > 120);
      lastY = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return { hidden, solid };
}

export function LandingNav() {
  const { hidden, solid } = useNavState();
  return (
    <header className={cn("sf-nav", hidden && "is-hidden", solid && "is-solid")}>
      <div className="sf-nav-inner">
        <Link to="/" className="sf-brand" aria-label="Sideform home">
          <SideformLockup className="sf-brand-logo" />
        </Link>
        <div className="sf-nav-right">
          <nav aria-label="Sections" className="sf-nav-links">
            {NAV_LINKS.map(({ href, label }) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </nav>
          <div className="sf-nav-actions">
            <AuthMenu variant="showcase" />
            {/* A real <Link>, not a button with navigate(): this is plain
                navigation, so it keeps link semantics (middle-click, "open in
                new tab"). */}
            <Link
              to="/app"
              className="sf-nav-text-link"
              onClick={() => track("showcase_editor_cta_clicked", { source: "header" })}
            >
              Try in browser
            </Link>
            {/* The desktop shell ships from its own repo (pen-editor-desktop), so
                its build artifacts live on GitHub Releases, not here. Link the
                "latest" release page, which never goes stale. */}
            <a
              href={DESKTOP_DOWNLOAD_URL}
              target="_blank"
              rel="noreferrer"
              className="sf-btn sf-btn-compact"
              onClick={() => track("landing_download_clicked", { source: "header" })}
            >
              Download for Mac
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}

/** The three offset lines of a big title. Word indexes continue across lines so the reveal staggers. */
function StackedTitle({ lines }: { lines: readonly [string, string, string] }) {
  const alignments = ["start", "end", "center"] as const;
  return (
    <>
      {lines.map((text, index) => (
        <span key={text} className={`sf-line sf-line-${alignments[index]}`}>
          <Words text={text} start={index * 2} />
        </span>
      ))}
    </>
  );
}

export function LandingHero() {
  return (
    <section className="sf-hero" aria-labelledby="hero-title">
      <LiquidGradient className="sf-gradient" coveredBy=".sf-over" />
      <h1 id="hero-title" className="sf-hero-title sf-reveal is-in">
        <StackedTitle lines={["One agent,", "three apps,", "one window."]} />
      </h1>
      <dl className="sf-hero-details">
        {DETAILS.map(({ label, value }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function LandingSectionHead({
  id,
  title,
  text,
  wide,
}: {
  id: string;
  title: string;
  text?: string;
  wide?: boolean;
}) {
  return (
    <div className={cn("sf-head", wide && "sf-head-wide")}>
      <RevealText as="h2" id={id} text={title} className="sf-h2" />
      {text ? <p className="sf-sub">{text}</p> : null}
    </div>
  );
}

/** Everything between the hero and the showcase gallery. */
export function LandingStory() {
  return (
    <>
      <section className="sf-section sf-about" aria-label="Overview">
        <div className="sf-container sf-about-grid">
          <div className="sf-about-copy">
            <RevealText
              text="A browser the agent drives, a design canvas and Notion-style docs in one desktop app. The same agent works across all three, so research, design and the write-up happen in one task."
              className="sf-lead"
            />
            <div className="sf-button-row">
              <a
                className="sf-btn sf-btn-primary"
                href={DESKTOP_DOWNLOAD_URL}
                target="_blank"
                rel="noreferrer"
                onClick={() => track("landing_download_clicked", { source: "about" })}
              >
                Download for Mac
              </a>
              <Link
                className="sf-btn sf-btn-secondary"
                to="/app"
                onClick={() => track("showcase_editor_cta_clicked", { source: "about" })}
              >
                Try in the browser
              </Link>
            </div>
          </div>
          <ul className="sf-stats">
            {STATS.map(({ value, label }) => (
              <RevealBlock as="li" key={label} className="sf-stat">
                <p className="sf-stat-value">{value}</p>
                <p className="sf-stat-label">{label}</p>
              </RevealBlock>
            ))}
          </ul>
        </div>
      </section>

      <section id="apps" className="sf-section" aria-labelledby="apps-title">
        <div className="sf-container sf-stack">
          <LandingSectionHead
            id="apps-title"
            title="Three apps, one agent"
            text="A browser, a design canvas and docs live in one desktop window. The same agent works in each of them."
          />
          <div className="sf-cards">
            {APPS.map(({ name, text, color }) => (
              <article key={name} className="sf-card">
                <div className="sf-card-top">
                  <h3 className="sf-h6">{name}</h3>
                  <Dots kind="cluster" color={color} />
                </div>
                <p className="sf-small">{text}</p>
              </article>
            ))}
            <article className="sf-card">
              <div className="sf-card-top">
                <h3 className="sf-h6">Already use Claude Code?</h3>
              </div>
              <div className="sf-card-cta">
                <p className="sf-small">Connect it to the same canvas through MCP.</p>
                <a className="sf-link" href={PLUGIN_URL} target="_blank" rel="noreferrer">
                  Read the setup guide
                </a>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section id="use-cases" className="sf-section" aria-labelledby="use-cases-title">
        <div className="sf-container sf-stack">
          <LandingSectionHead
            id="use-cases-title"
            title="Three apps at work"
            text="Each task below runs from start to finish in the desktop app. The agent decides which tab to open next."
          />
          <div className="sf-days">
            {ROLES.map(({ label, heading, prompt, steps }) => (
              <article key={label} className="sf-day">
                <div className="sf-day-head">
                  <p className="sf-meta">{label}</p>
                  <h3 className="sf-h5">{heading}</h3>
                </div>
                <ol className="sf-rows">
                  <li>
                    <p className="sf-meta">You ask</p>
                    <p className="sf-small sf-white">{prompt}</p>
                  </li>
                  {steps.map((step, index) => (
                    <li key={step}>
                      <p className="sf-meta">{`Step ${index + 1} · ${STEP_APPS[index]}`}</p>
                      <p className="sf-small sf-white">{step}</p>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function PlainButton({
  kind,
  className,
  label,
  placement,
}: {
  kind: "download" | "open" | "setup";
  className: string;
  label: string;
  placement: "get_started" | "runs_table";
}) {
  if (kind === "download") {
    return (
      <a
        className={className}
        href={DESKTOP_DOWNLOAD_URL}
        target="_blank"
        rel="noreferrer"
        onClick={() =>
          track("landing_download_clicked", {
            source: placement === "runs_table" ? "runs_table" : "download_section",
          })
        }
      >
        {label}
      </a>
    );
  }
  if (kind === "open") {
    return (
      <Link
        className={className}
        to="/app"
        onClick={() =>
          track("showcase_editor_cta_clicked", {
            source: placement === "runs_table" ? "runs_table" : "try_section",
          })
        }
      >
        {label}
      </Link>
    );
  }
  return (
    <a className={className} href={PLUGIN_URL} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

const GET_LABELS = { download: "Download for Mac", open: "Open the editor", setup: "Read the setup guide" } as const;
const RUNS_LABELS = { download: "Download", open: "Open", setup: "Setup" } as const;

const GET_CARDS = [
  {
    title: "Sideform for Mac",
    tag: "Recommended",
    big: "Mac",
    color: ORANGE,
    bullets: [
      "Agent that drives a real browser",
      "Canvas, docs and traces in tabs",
      "Connect Claude Code or another agent through MCP",
    ],
    action: "download",
  },
  {
    title: "In the browser",
    tag: "No install",
    big: "Web",
    color: PALE,
    bullets: ["Canvas and the design agent", "No account needed", "Browser control needs the Mac app"],
    action: "open",
  },
  {
    title: "Your own agent",
    tag: "Via MCP",
    big: "MCP",
    color: BLUE,
    bullets: ["Claude Code or another MCP client", "Works on the same canvas", "Setup guide on GitHub"],
    action: "setup",
  },
] as const;

const WHY_ROWS = [
  { key: "No hand-offs", value: "One task, start to finish" },
  { key: "Shared context", value: "You never explain the task twice" },
  { key: "Its own tabs", value: "Opens browser, canvas or docs itself" },
] as const;

/** Download and try-in-browser cards, the "why", the FAQ and the prompt box. After the gallery. */
export function LandingClosing({ onAgentPrompt }: { onAgentPrompt: (prompt: string) => void }) {
  return (
    <>
      <section id="get-started" className="sf-section" aria-labelledby="start-title">
        <div className="sf-container sf-stack">
          <LandingSectionHead
            id="start-title"
            title="Get Sideform"
            text="The Mac app is the full workspace. The browser version needs no install. Your own agent connects through MCP."
          />
          <div className="sf-tickets">
            {GET_CARDS.map(({ title, tag, big, color, bullets, action }) => (
              <article key={title} className="sf-ticket">
                <div className="sf-ticket-content">
                  <div className="sf-ticket-price">
                    <div>
                      <h3 className="sf-h6">{title}</h3>
                      <p className="sf-h2 sf-big">{big}</p>
                    </div>
                    <p className="sf-meta sf-tag">{tag}</p>
                  </div>
                  <hr className="sf-divider" />
                  <ul className="sf-bullets">
                    {bullets.map((bullet) => (
                      <li key={bullet}>
                        <Dots kind="bullet" color={color} />
                        <p className="sf-body">{bullet}</p>
                      </li>
                    ))}
                  </ul>
                </div>
                <PlainButton
                  kind={action}
                  className="sf-btn sf-btn-primary sf-btn-block"
                  label={GET_LABELS[action]}
                  placement="get_started"
                />
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="why" className="sf-section" aria-labelledby="why-title">
        <div className="sf-container sf-stack">
          <LandingSectionHead id="why-title" title="Fast because it is connected." wide />
          <div className="sf-why">
            <div className="sf-why-details">
              <p className="sf-small">
                Nothing to copy from a browser to a design tool to a doc. One task goes from the first reference to the
                final write-up.
              </p>
              <dl className="sf-kv">
                {WHY_ROWS.map(({ key, value }) => (
                  <div key={key}>
                    <dt className="sf-meta">{key}</dt>
                    <dd className="sf-small sf-white">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="sf-runs">
                <h3 className="sf-meta">Where it runs</h3>
                <ul>
                  {RUNS_ON.map(({ name, what, where, action }) => (
                    <li key={name}>
                      <span>{name}</span>
                      <span>{what}</span>
                      <span>{where}</span>
                      <PlainButton
                        kind={action}
                        className="sf-text-action"
                        label={RUNS_LABELS[action]}
                        placement="runs_table"
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <img
              className="sf-why-image"
              src={`${EDITOR_SHOT}-1440.webp`}
              srcSet={`${EDITOR_SHOT}-1440.webp 1440w, ${EDITOR_SHOT}.webp 2880w`}
              sizes="(min-width: 1200px) 560px, (min-width: 810px) 746px, 350px"
              width={2880}
              height={1800}
              loading="lazy"
              decoding="async"
              alt="The Sideform editor in dark mode: layers, canvas with three app screens, and properties panel"
            />
          </div>
        </div>
      </section>

      <section id="faq" className="sf-section" aria-labelledby="faq-title">
        <div className="sf-container sf-faq">
          <RevealText as="h2" id="faq-title" text="Questions, answered" className="sf-h2" />
          <div className="sf-accordion">
            {FAQ.map(({ question, answer }) => (
              <details key={question}>
                <summary>
                  <span>{question}</span>
                  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                    <path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="1.2" fill="none" />
                  </svg>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="sf-section sf-try" aria-labelledby="try-title">
        <div className="sf-try-grid">
          <div>
            <p className="sf-body sf-upper">Try it now</p>
            <h2 id="try-title" className="sf-h4">
              Describe a screen. The agent designs it.
            </h2>
          </div>
          <ShowcaseAgentComposer onSubmit={onAgentPrompt} />
        </div>
      </section>
    </>
  );
}

export function LandingFooter() {
  return (
    <footer className="sf-footer">
      <LiquidGradient className="sf-gradient" />
      <p className="sf-footer-tag">Sideform · macOS and web</p>
      <Link
        to="/app"
        className="sf-btn sf-btn-compact sf-footer-cta"
        onClick={() => track("showcase_editor_cta_clicked", { source: "footer" })}
      >
        Try in browser
      </Link>
      <p className="sf-footer-title sf-reveal is-in">
        <StackedTitle lines={["One prompt,", "three apps,", "at work."]} />
      </p>
      <nav aria-label="Footer" className="sf-footer-nav">
        {NAV_LINKS.map(({ href, label }) => (
          <a key={href} href={href}>
            {label}
          </a>
        ))}
      </nav>
      <div className="sf-footer-credits">
        <p>© 2026 Sideform.</p>
        <a href={SOURCE_URL} target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </div>
      <LegalLinks className="sf-footer-legal" />
    </footer>
  );
}
