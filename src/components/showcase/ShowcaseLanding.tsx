import { createElement, useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router";

import { AuthMenu } from "@/components/auth/AuthMenu";
import { SideformLockup, SideformMark } from "@/components/brand/SideformLogo";
import {
  ArrowUpIcon,
  BrainIcon,
  BrowsersIcon,
  CaretDownIcon,
  EqualsIcon,
  FlowArrowIcon,
  LightningIcon,
  PaperclipIcon,
} from "@/components/icons";
import { Button, buttonVariants } from "@/components/ui/button";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { CHEVRON_WEIGHT } from "@/components/ui/chevron";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { AutoplayVideo } from "@/components/showcase/landing/AutoplayVideo";
import { LiquidGradient } from "@/components/showcase/landing/LiquidGradient";
import { RevealText, Words } from "@/components/showcase/landing/Reveal";
import { track } from "@/lib/analytics";
import { getToolIcon } from "@/lib/toolIcons";
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


const SOURCE_URL = "https://github.com/dan-rozhkov/pen-editor";

const ORANGE = "#ff4000";
const PALE = "#c0d5d0";
const BLUE = "#3c50a5";

const NAV_LINKS = [
  { href: "#apps", label: "Apps" },
  { href: "#use-cases", label: "Use cases" },
  { href: "#gallery", label: "Showcase" },
  { href: "#faq", label: "FAQ" },
] as const;

const APPS: { name: string; text: string; color: string; shot: "browser" | "canvas" | "doc"; alt: string }[] = [
  {
    name: "Browser",
    shot: "browser",
    alt: "Screen recording: three agent cursors fill a pre-order form on a store page at the same time",
    text: "The agent opens real sites, clicks through flows and saves references. Point it at staging and it checks the build. You see every step in a tab.",
    color: ORANGE,
  },
  {
    name: "Canvas",
    shot: "canvas",
    alt: "Screen recording: the agent designs a dark mobile screen on the canvas, then the screen is selected",
    text: "Every screen lands as an editable frame, side by side. Compare directions, fix a detail by hand or ask for another option.",
    color: PALE,
  },
  {
    name: "Docs",
    shot: "doc",
    alt: "Screen recording: the agent writes a brief, inserts a canvas frame as an image, then text is selected and the bubble menu appears",
    text: "Write specs, PRDs, notes and bug reports in a Notion-style editor. The agent links each doc to the frames it describes.",
    color: BLUE,
  },
];

const ROLES: { label: string; heading: string; prompt: string; steps: [string, string, string] }[] = [
  {
    label: "For designers",
    heading: "Designers",
    prompt: "Collect onboarding references from apps we like, design ours in our style and note the decisions.",
    steps: ["Collects references", "Designs 3 screens", "Notes the decisions"],
  },
  {
    label: "For product builders",
    heading: "Product builders",
    prompt: "Compare three competitor pricing pages, mock up ours and draft a one-page PRD.",
    steps: ["Compares pricing pages", "Mocks up ours", "Drafts the PRD"],
  },
  {
    label: "For QA testers",
    heading: "QA testers",
    prompt: "Run sign-up on staging, mark each step that breaks and write the bug report.",
    steps: ["Runs sign-up", "Marks what breaks", "Writes the bug report"],
  },
];

/** Each step's app and the agent tool whose chat row (icon) it reuses. */
const STEP_APPS = [
  { app: "Browser", tool: "browse_open" },
  { app: "Canvas", tool: "batch_design" },
  { app: "Docs", tool: "doc_create" },
] as const;
const STEP_RUN_MS = 1400;
const THINK_MS = 2000;

const FAQ: { question: string; answer: React.ReactNode }[] = [
  {
    question: "Mac app or browser version: what is the difference?",
    answer:
      "The browser version has the canvas and the design agent. No install, no account. The Mac app adds the agent-driven browser, tabs for docs and run traces, and saves your work on your computer.",
  },
  {
    question: "Does the agent really use a browser?",
    answer:
      "Yes. In the Mac app it opens sites in a tab, clicks, types and reads the page while you watch. Each run keeps a trace you can open later.",
  },
  {
    question: "Can I use the agent I already work with?",
    answer: (
      <>
        Yes. Claude Code, Codex and other MCP clients can connect to the same canvas and work on your frames
        there.{" "}
        <a href={PLUGIN_URL} target="_blank" rel="noreferrer">
          Read the setup guide.
        </a>
      </>
    ),
  },
  {
    question: "I already use Figma and Notion. Where does Sideform fit?",
    answer:
      "Sideform covers the early part: research, first concepts and the first write-up, in one task. Keep Figma and Notion for the rest of your process.",
  },
  {
    question: "Is the output production code?",
    answer:
      "No. The screens are HTML prototypes for exploring a direction. Review them and adapt them to your app before you ship.",
  },
];

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

/** True once the page has scrolled, so the header's blur shows only over content, never over the bare hero. */
function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return scrolled;
}

export function LandingNav() {
  const scrolled = useScrolled();
  return (
    <header className={cn("sf-nav", scrolled && "is-scrolled")}>
      {/* Progressive blur (as in arc-ui's HeaderBackdrop): stacked backdrop blurs, each masked to an
          overlapping band, strongest at the top; it runs a little past the bar. */}
      <div className="sf-nav-backdrop" aria-hidden>
        <div />
        <div />
        <div />
        <div />
      </div>
      <div className="sf-nav-inner">
        <Link to="/" className="sf-brand" aria-label="Sideform home">
          <SideformLockup className="sf-brand-logo" />
        </Link>
        <div className="sf-nav-right">
          <div className="sf-nav-actions">
            <AuthMenu variant="showcase" />
            {/* The desktop shell ships from its own repo (pen-editor-desktop), so
                its build artifacts live on GitHub Releases, not here. Link the
                "latest" release page, which never goes stale. */}
            <a
              href={DESKTOP_DOWNLOAD_URL}
              target="_blank"
              rel="noreferrer"
              className={BUTTON_PRIMARY}
              data-slot="button"
              aria-label="Download for Mac"
              onClick={() => track("landing_download_clicked", { source: "header" })}
            >
              Download
            </a>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-lg" aria-label="Menu">
                    <EqualsIcon />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="min-w-44">
                {NAV_LINKS.map(({ href, label }) => (
                  <DropdownMenuItem key={href} render={<a href={href} />}>
                    {label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                {/* A real <Link>: plain navigation keeps link semantics (middle-click, "open in new tab"). */}
                <DropdownMenuItem
                  render={<Link to="/workspace" />}
                  onClick={() => track("showcase_editor_cta_clicked", { source: "header" })}
                >
                  Try in browser
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
          <Words text={text} start={lines.slice(0, index).join(" ").split(" ").filter(Boolean).length} />
        </span>
      ))}
    </>
  );
}

/** The hero title fades out with scroll progress: fully transparent after half a viewport. */
function useScrollFade<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const progress = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.5)));
      if (ref.current) ref.current.style.opacity = String(1 - progress);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return ref;
}

export function LandingHero() {
  // The eyebrow and the title fade out together with scroll.
  const copyRef = useScrollFade<HTMLDivElement>();
  return (
    <section className="sf-hero" aria-labelledby="hero-title">
      <LiquidGradient className="sf-gradient" coveredBy=".sf-over" />
      <div ref={copyRef} className="sf-hero-copy">
        <p className="sf-hero-eyebrow">Open-source · Free</p>
        <h1 id="hero-title" className="sf-hero-title sf-reveal is-in">
          <StackedTitle lines={["Research it.", "Design it.", "Write it up."]} />
        </h1>
      </div>
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
  // The stacked app cards; each clip asks for the next card to know when it is covered.
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  return (
    <>
      <section className="sf-section sf-about" aria-label="Overview">
        <div className="sf-container sf-about-grid">
          <div className="sf-about-copy">
            <RevealText
              text="Sideform puts a browser the agent drives, a design canvas and Notion-style docs in one Mac app. Ask once. The agent finds references, designs the screens and writes the spec, and you watch every step."
              className="sf-lead"
            />
            <div className="sf-button-row">
              <a
                className={BUTTON_PRIMARY}
                data-slot="button"
                href={DESKTOP_DOWNLOAD_URL}
                aria-label="Download for Mac"
                target="_blank"
                rel="noreferrer"
                onClick={() => track("landing_download_clicked", { source: "about" })}
              >
                Download
              </a>
              <Link
                className={BUTTON_SECONDARY}
                data-slot="button"
                to="/workspace"
                onClick={() => track("showcase_editor_cta_clicked", { source: "about" })}
              >
                Try in the browser
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="apps" className="sf-section" aria-labelledby="apps-title">
        <div className="sf-container sf-stack">
          <LandingSectionHead
            id="apps-title"
            title="One window, three apps"
            text="The agent moves between a browser, a canvas and docs on its own. You never copy work from one tool to the next."
          />
          {/* A stack: every card sticks under the header a step below the previous one, so the next
              card slides over it as the page scrolls. */}
          <div className="sf-cards">
            {APPS.map(({ name, text, color, shot, alt }, index) => (
              <article
                key={name}
                ref={(node) => {
                  cardRefs.current[index] = node;
                }}
                className="sf-card"
                style={{ "--i": index } as CSSProperties}
              >
                <AutoplayVideo
                  src={`${LANDING_ASSETS}sideform-video-${shot}.mp4`}
                  poster={`${LANDING_ASSETS}sideform-video-${shot}-poster.webp`}
                  label={alt}
                  name={name}
                  coveredBy={() => cardRefs.current[index + 1] ?? null}
                />
                <div className="sf-card-body">
                  <div className="sf-card-top">
                    <h3 className="sf-card-title">{name}</h3>
                    <Dots kind="cluster" color={color} />
                  </div>
                  <p className="sf-small">{text}</p>
                </div>
              </article>
            ))}
            <article className="sf-card" style={{ "--i": APPS.length } as CSSProperties}>
              <div className="sf-card-body">
                <div className="sf-card-top">
                  <h3 className="sf-card-title">Already use Claude Code or Codex?</h3>
                </div>
                <div className="sf-card-cta">
                  <p className="sf-small">Connect it over MCP and it works on the same canvas.</p>
                  <a
                    className={cn(BUTTON_PRIMARY, "self-start")}
                    data-slot="button"
                    href={PLUGIN_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Read the setup guide
                  </a>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section id="use-cases" className="sf-section" aria-labelledby="use-cases-title">
        <div className="sf-container sf-stack">
          <LandingSectionHead
            id="use-cases-title"
            title="One request, start to finish"
            text="Each request below runs end to end in the Mac app. The agent picks the tab it needs next."
          />
          <div className="sf-days">
            {ROLES.map(({ label, heading, prompt, steps }) => (
              <article key={label} className="sf-day">
                <div className="sf-day-head">
                  <p className="sf-small">{label}</p>
                  <h3 className="sf-card-title">{heading}</h3>
                </div>
                <ReadonlyPrompt text={prompt} />
                <RoleSteps steps={steps} />
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * The agent's answer as the chat shows it: a "Sideform Agent" label, then a thinking row
 * (ThinkingIndicator: "Thinking..." with the chat's shimmer, then "Thought 2s"), then one row per step
 * as a tool call (ToolCallIndicator: tool icon, name, muted hint, status, chevron). Once the answer is
 * on screen the rows run one by one; rows not reached yet stay hidden. Reduced motion shows it done.
 */
function RoleSteps({ steps }: { steps: readonly string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  // Rows: the thinking row, then the steps. `started` counts started rows; the last one runs until
  // the next starts. Reduced motion (or no IntersectionObserver): everything done, no sequence.
  const rowCount = steps.length + 1;
  const [instant] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true || !("IntersectionObserver" in window),
  );
  const [started, setStarted] = useState(instant ? rowCount : 0);
  const [finished, setFinished] = useState(instant);

  useEffect(() => {
    const answer = ref.current;
    if (!answer || instant) return;
    const timers: number[] = [];
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        // The thinking row starts at once and lasts THINK_MS; then each step lasts STEP_RUN_MS.
        timers.push(window.setTimeout(() => setStarted(1), 0));
        for (let index = 0; index < steps.length; index += 1) {
          timers.push(window.setTimeout(() => setStarted(index + 2), THINK_MS + index * STEP_RUN_MS));
        }
        timers.push(window.setTimeout(() => setFinished(true), THINK_MS + steps.length * STEP_RUN_MS));
      },
      { threshold: 0.4 },
    );
    observer.observe(answer);
    return () => {
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [steps, instant]);

  const rowClass = (visible: boolean) =>
    cn("sf-step flex w-full items-center gap-1.5 py-0.5 text-[13px] leading-relaxed text-text-muted", visible && "is-in");
  const isRunning = (row: number) => row < started && !finished && row === started - 1;
  const thinking = isRunning(0);

  return (
    <div ref={ref} className="sf-answer">
      <p className="flex items-center gap-2 text-sm font-medium text-text-primary">
        <SideformMark className="size-4 shrink-0" aria-hidden />
        Sideform Agent
      </p>
      <ol className="sf-steps" aria-label="What the agent does">
        <li className={rowClass(started > 0)} aria-hidden={started === 0}>
          {thinking ? (
            <Shimmer as="span" className="truncate">
              Thinking...
            </Shimmer>
          ) : (
            <span className="truncate">Thought</span>
          )}
          {!thinking && <span className="shrink-0 text-text-disabled">{`${Math.round(THINK_MS / 1000)}s`}</span>}
          <CaretDownIcon size={10} className="shrink-0 -rotate-90" weight={CHEVRON_WEIGHT} aria-hidden />
        </li>
        {steps.map((step, index) => {
          const { app, tool } = STEP_APPS[index] ?? STEP_APPS[0];
          const row = index + 1;
          const visible = row < started;
          const running = isRunning(row);
          return (
            <li key={step} className={rowClass(visible)} aria-hidden={!visible}>
              {createElement(getToolIcon(tool), { size: 14, className: "shrink-0", "aria-hidden": true })}
              {running ? (
                <Shimmer as="span" className="truncate">
                  {step}
                </Shimmer>
              ) : (
                <span className="truncate">{step}</span>
              )}
              <span className="min-w-0 shrink-[999] truncate text-text-disabled">{app}</span>
              <span className="shrink-0 text-text-disabled">
                {running ? <Shimmer as="span">Running...</Shimmer> : "Done"}
              </span>
              <CaretDownIcon size={10} className="shrink-0 -rotate-90" weight={CHEVRON_WEIGHT} aria-hidden />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * A read-only copy of the agent chat composer (ChatPanel + ChatInput: same frame, type and controls),
 * already filled in. Nothing in it is interactive; it only shows what the person types.
 */
function ReadonlyPrompt({ text }: { text: string }) {
  return (
    <figure className="sf-prompt overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <figcaption className="sr-only">You ask</figcaption>
      <p className="px-4 pt-3 pb-1 text-sm leading-normal text-text-primary">{text}</p>
      <div className="flex items-center gap-0.5 px-2 pb-1.5 pt-1 text-text-muted" aria-hidden>
        <span className="inline-flex size-[30px] items-center justify-center">
          <PaperclipIcon size={16} weight="light" />
        </span>
        <span className="ml-auto inline-flex size-[30px] items-center justify-center">
          <BrainIcon size={16} weight="light" />
        </span>
        <span className="inline-flex h-[30px] items-center gap-1 px-1.5 text-xs leading-none">
          <LightningIcon size={16} weight="light" />
          x1
          <CaretDownIcon className="size-3" weight={CHEVRON_WEIGHT} />
        </span>
        <span className="inline-flex size-[30px] items-center justify-center rounded-control-lg bg-accent-primary text-white">
          <ArrowUpIcon size={16} weight="light" />
        </span>
      </div>
    </figure>
  );
}

/** The action button of a get-started card: download, open the editor, or the MCP setup guide. */
function PlainButton({
  kind,
  className,
  label,
}: {
  kind: "download" | "open" | "setup";
  className: string;
  label: string;
}) {
  const slot = "button";
  if (kind === "download") {
    return (
      <a
        className={className}
        data-slot={slot}
        href={DESKTOP_DOWNLOAD_URL}
        target="_blank"
        rel="noreferrer"
        onClick={() =>
          track("landing_download_clicked", { source: "download_section" })
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
        data-slot={slot}
        to="/workspace"
        onClick={() =>
          track("showcase_editor_cta_clicked", { source: "try_section" })
        }
      >
        {label}
      </Link>
    );
  }
  return (
    <a className={className} data-slot={slot} href={PLUGIN_URL} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

const GET_LABELS = { download: "Download for Mac", open: "Open the editor", setup: "Read the setup guide" } as const;

const GET_CARDS = [
  {
    title: "Sideform for Mac",
    color: ORANGE,
    bullets: [
      "An agent that drives a real browser",
      "Canvas, docs and run traces in tabs",
      "Works with Claude Code and other MCP agents",
    ],
    action: "download",
  },
  {
    title: "Web editor",
    color: PALE,
    bullets: ["Canvas and the design agent", "No install, no account", "Browser control needs the Mac app"],
    action: "open",
  },
  {
    title: "Your own agent",
    color: BLUE,
    bullets: ["Claude Code, Codex or any MCP client", "Works on the same canvas", "Setup guide on GitHub"],
    action: "setup",
  },
] as const;

const WHY_ROWS = [
  { key: "No hand-offs", value: "From reference to spec in one task", icon: FlowArrowIcon },
  { key: "Shared context", value: "Explain the task once", icon: BrainIcon },
  { key: "Its own tabs", value: "Picks browser, canvas or docs itself", icon: BrowsersIcon },
] as const;

/** Download and try-in-browser cards, the "why" and the FAQ. After the gallery. */
export function LandingClosing() {
  return (
    <>
      <section id="get-started" className="sf-section" aria-labelledby="start-title">
        <div className="sf-container sf-stack">
          <LandingSectionHead
            id="start-title"
            title="Pick how to start"
            text="Get the full workspace on a Mac. Try the canvas in your browser with no install. Or connect the agent you already use."
          />
          <div className="sf-tickets">
            {GET_CARDS.map(({ title, color, bullets, action }) => (
              <article key={title} className="sf-ticket">
                <div className="sf-ticket-content">
                  <h3 className="sf-card-title">{title}</h3>
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
                  className={cn(BUTTON_PRIMARY, "w-full")}
                  label={GET_LABELS[action]}
                />
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="why" className="sf-section" aria-labelledby="why-title">
        <div className="sf-container sf-stack">
          <LandingSectionHead
            id="why-title"
            title="No copy-paste between tools."
            text="References, screens and specs live in one window. The agent keeps the context from the first reference to the final write-up."
            wide
          />
          {/* The reasons in a grid (see .sf-reasons): an icon from the editor's set, the short label, then the claim. */}
          <ul className="sf-reasons">
            {WHY_ROWS.map(({ key, value, icon: Icon }) => (
              <li key={key} className="sf-reason">
                <Icon size={28} weight="light" aria-hidden className="sf-reason-icon" />
                <p className="sf-small">{key}</p>
                <h3 className="sf-card-title">{value}</h3>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="faq" className="sf-section" aria-labelledby="faq-title">
        <div className="sf-container sf-faq">
          <RevealText as="h2" id="faq-title" text="Common questions" className="sf-h2" />
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
    </>
  );
}

export function LandingFooter() {
  return (
    <footer className="sf-footer">
      <LiquidGradient className="sf-gradient" />
      <p className="sf-footer-tag">Sideform · macOS and web</p>
      <Link
        to="/workspace"
        className={cn(BUTTON_PRIMARY, "sf-footer-cta")}
        data-slot="button"
        onClick={() => track("showcase_editor_cta_clicked", { source: "footer" })}
      >
        Try in browser
      </Link>
      <p className="sf-footer-title sf-reveal is-in">
        <StackedTitle lines={["One task,", "one agent,", "one window."]} />
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
      </div>
      {/* Right column: the source link, then the legal links (their <nav> is display: contents). */}
      <div className="sf-footer-legal">
        <a href={SOURCE_URL} target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
        <LegalLinks className="contents" />
      </div>
    </footer>
  );
}

/** The landing uses the editor's own buttons: same shape, size, type and colours as in /app. */
const BUTTON_PRIMARY = buttonVariants({ variant: "default", size: "lg" });
const BUTTON_SECONDARY = buttonVariants({ variant: "outline", size: "lg" });

const LANDING_ASSETS = `${import.meta.env.BASE_URL}landing/`;
const DESKTOP_SHOT = `${import.meta.env.BASE_URL}landing/sideform-desktop`;
/** Sideform Desktop with the agent panel, one frame per tab kind. Captured by scripts/landing-hero/capture-desktop.mjs. */
const HERO_FRAMES = ["canvas", "browser", "doc"] as const;
const HERO_FRAME_MS = 4000;

/**
 * The real app window (dark), overlapping the bottom of the sticky hero. It cross-fades between a
 * canvas, a browser and a document tab. With reduced motion it stays on the canvas frame.
 */
export function LandingHeroWindow() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setActive((i) => (i + 1) % HERO_FRAMES.length);
    }, HERO_FRAME_MS);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="sf-hero-window">
      <div
        className="sf-hero-slides"
        role="img"
        aria-label="Sideform Desktop in dark mode: the agent panel next to a canvas tab, a browser tab and a document tab"
      >
        {HERO_FRAMES.map((frame, index) => (
          <img
            key={frame}
            className={cn("sf-hero-slide", index === active && "is-active")}
            src={`${DESKTOP_SHOT}-${frame}-1440.webp`}
            srcSet={`${DESKTOP_SHOT}-${frame}-1440.webp 1440w, ${DESKTOP_SHOT}-${frame}.webp 2880w`}
            sizes="(min-width: 1280px) 1200px, calc(100vw - 32px)"
            width={2880}
            height={1800}
            alt=""
            fetchPriority={index === 0 ? "high" : "low"}
            decoding="async"
          />
        ))}
      </div>
    </div>
  );
}
