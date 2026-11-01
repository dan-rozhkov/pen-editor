import { Link } from "react-router";

import {
  AppleLogoIcon,
  ArrowUpRightIcon,
  BrowserIcon,
  FileTextIcon,
  LightningIcon,
  LinkIcon,
  PenNibIcon,
  SparkleIcon,
  type Icon,
} from "@/components/icons";
import { ShowcaseAgentComposer } from "@/components/showcase/ShowcaseAgentComposer";
import { track } from "@/lib/analytics";

export const PLUGIN_URL = "https://github.com/dan-rozhkov/pen-editor-plugin#setup";

// The macOS build of the desktop shell (../pen-editor-desktop) is published as
// a GitHub release asset. "/releases/latest" always resolves to the newest one,
// so this URL survives every desktop release untouched.
export const DESKTOP_DOWNLOAD_URL =
  "https://github.com/dan-rozhkov/pen-editor-desktop/releases/latest";

const APPS: { icon: Icon; name: string; title: string; text: string; points: string[] }[] = [
  {
    icon: BrowserIcon,
    name: "Browser",
    title: "An agent that uses the web for you.",
    text: "The agent opens real sites, clicks through flows, collects references and checks your staging build. You watch every step in a tab.",
    points: ["Research and references", "Click-through QA runs", "A replayable trace of each run"],
  },
  {
    icon: PenNibIcon,
    name: "Canvas",
    title: "A canvas the agent designs on.",
    text: "Screens appear as editable frames next to each other. Compare directions, change a detail and ask for one more option.",
    points: ["Whole flows, not single screens", "Side-by-side alternatives", "Edit by hand or by prompt"],
  },
  {
    icon: FileTextIcon,
    name: "Docs",
    title: "Docs that write themselves down.",
    text: "Specs, PRDs, design notes and bug reports in a Notion-style editor. The agent links them to the frames they describe.",
    points: ["Headings, tables, callouts", "Links to canvas frames", "Edit together with the agent"],
  },
];

const REASONS: { icon: Icon; title: string; text: string }[] = [
  {
    icon: LinkIcon,
    title: "No hand-offs",
    text: "Nothing to copy from a browser to a design tool to a doc. One task goes from the first reference to the final write-up.",
  },
  {
    icon: SparkleIcon,
    title: "One shared context",
    text: "What the agent saw in the browser shapes the screens, and the screens shape the doc. You never explain the task twice.",
  },
  {
    icon: LightningIcon,
    title: "It opens what it needs",
    text: "The agent opens a browser, canvas or doc tab by itself, works in several at once and leaves each one ready for you.",
  },
];

const ROLES: { role: string; title: string; prompt: string; steps: [string, string, string] }[] = [
  {
    role: "For designers",
    title: "From references to a flow, with the reasons written down.",
    prompt: "“Find onboarding references on Mobbin, design ours in our style and write down the decisions.”",
    steps: ["Saves references", "Designs 3 screens", "Writes design notes"],
  },
  {
    role: "For product builders",
    title: "From a market scan to a page and a PRD in one go.",
    prompt: "“Compare competitor pricing pages, mock up ours and draft a one-page PRD.”",
    steps: ["Compares competitors", "Mocks up the page", "Drafts the PRD"],
  },
  {
    role: "For QA testers",
    title: "Test the flow, mark what breaks, file the report.",
    prompt: "“Test sign-up on staging, mark what breaks and file a bug report.”",
    steps: ["Runs the flow", "Marks failures", "Files the bug report"],
  },
];

const STEP_ICONS: Icon[] = [BrowserIcon, PenNibIcon, FileTextIcon];

/** Everything between the hero and the showcase gallery. */
export function LandingStory() {
  return (
    <div className="sf-story">
      <section id="apps" aria-labelledby="apps-title" className="sf-apps">
        <div className="sf-section-intro">
          <h2 id="apps-title">Three apps.<br />One agent over all of them.</h2>
          <p>A browser, a design canvas and docs live in one desktop window. The same agent works in each of them.</p>
        </div>
        <div className="sf-app-grid">
          {APPS.map(({ icon: AppIcon, name, title, text, points }) => (
            <article key={name} className="sf-app-card">
              <span className="sf-app-name"><AppIcon size={18} weight="regular" aria-hidden /> {name}</span>
              <h3>{title}</h3>
              <p>{text}</p>
              <ul>{points.map((point) => <li key={point}>{point}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="why-title" className="sf-why">
        <h2 id="why-title">Fast because it is connected.</h2>
        <div className="sf-why-grid">
          {REASONS.map(({ icon: ReasonIcon, title, text }) => (
            <div key={title}>
              <ReasonIcon size={22} weight="regular" aria-hidden />
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="use-cases" aria-labelledby="use-cases-title" className="sf-workflow">
        <div className="sf-section-intro">
          <h2 id="use-cases-title">One prompt.<br />Three apps at work.</h2>
          <p>Each task below runs from start to finish in the desktop app. The agent decides which tab to open next.</p>
        </div>
        {ROLES.map(({ role, title, prompt, steps }) => (
          <article key={role} className="sf-workflow-row">
            <div className="sf-workflow-copy">
              <span className="sf-role-label">{role}</span>
              <h3>{title}</h3>
            </div>
            <div className="sf-prompt-example">
              <span className="sf-example-label">You ask once</span>
              <blockquote>{prompt}</blockquote>
              <ol className="sf-steps">
                {steps.map((step, i) => {
                  const StepIcon = STEP_ICONS[i]!;
                  return <li key={step}><StepIcon size={14} weight="regular" aria-hidden />{step}</li>;
                })}
              </ol>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

/** Download and try-in-browser cards, then the FAQ. After the gallery. */
export function LandingClosing({ onAgentPrompt }: { onAgentPrompt: (prompt: string) => void }) {
  return (
    <div className="sf-story">
      <section aria-labelledby="start-title" className="sf-get" id="get-started">
        <h2 id="start-title">Get Sideform.</h2>
        <div className="sf-get-grid">
          <article className="sf-get-card is-primary">
            <span className="sf-get-badge">Recommended</span>
            <h3>Sideform for Mac</h3>
            <p>The full workspace: the browser agent, the canvas and docs in tabs, with your work saved on your Mac.</p>
            <ul>
              <li>Agent that drives a real browser</li>
              <li>Canvas, docs and traces in tabs</li>
              <li>Connect Claude Code or another agent through MCP</li>
            </ul>
            <a
              className="sf-primary-link"
              href={DESKTOP_DOWNLOAD_URL}
              target="_blank"
              rel="noreferrer"
              onClick={() => track("landing_download_clicked", { source: "download_section" })}
            >
              <AppleLogoIcon size={17} weight="fill" aria-hidden /> Download for Mac
            </a>
          </article>
          <article className="sf-get-card">
            <h3>Try it in the browser</h3>
            <p>No install, no account. Describe a screen and the agent designs it on the canvas. Browser control needs the Mac app.</p>
            <ShowcaseAgentComposer onSubmit={onAgentPrompt} />
            <Link
              className="sf-text-link"
              to="/app"
              onClick={() => track("showcase_editor_cta_clicked", { source: "try_section" })}
            >
              Or open an empty canvas <ArrowUpRightIcon size={16} aria-hidden />
            </Link>
          </article>
        </div>
      </section>

      <section className="sf-faq" aria-labelledby="faq-title">
        <h2 id="faq-title">A few practical questions.</h2>
        <div>
          <details>
            <summary>What is the difference between the Mac app and the browser version?</summary>
            <p>The browser version gives you the canvas and the agent with no install, which is enough to try a concept. The Mac app adds the browser agent, tabs for docs and traces, and saves your work on your computer.</p>
          </details>
          <details>
            <summary>Does the agent really use a browser?</summary>
            <p>Yes. In the Mac app the agent opens sites in a tab, clicks, types and reads pages, and you see every step. Each run keeps a trace you can replay. Sites that need an account use your own sign-in.</p>
          </details>
          <details>
            <summary>Can I use the agent I already work with?</summary>
            <p>Yes. The desktop app connects to external agents, such as Claude Code, through MCP. Your agent then works on the same canvas. <a href={PLUGIN_URL} target="_blank" rel="noreferrer">Read the setup guide.</a></p>
          </details>
          <details>
            <summary>Where does Sideform fit if I already use Figma and Notion?</summary>
            <p>Use Sideform for the early, fast part: research, first concepts and the first write-up, done by one agent. Keep Figma and Notion wherever they fit your team.</p>
          </details>
          <details>
            <summary>Are the screens production-ready code?</summary>
            <p>They are HTML prototypes for exploring a direction. Review the result and adapt it to your application before you ship it.</p>
          </details>
        </div>
      </section>
    </div>
  );
}
