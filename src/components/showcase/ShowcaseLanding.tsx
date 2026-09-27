import { ArrowUpRightIcon, GitBranchIcon } from "@phosphor-icons/react";
import { Link } from "react-router";

const PLUGIN_URL = "https://github.com/dan-rozhkov/pen-editor-plugin#setup";
const asset = (name: string) => `${import.meta.env.BASE_URL}landing/${name}`;

export function LandingPreview() {
  return (
    <figure className="sf-preview">
      <div className="sf-preview-canvas">
        <div className="sf-preview-label"><span /> A mood-tracker concept, made with the design agent</div>
        <div className="sf-preview-screens">
          <img src={asset("mood-today.png")} alt="Mood-tracker concept: daily check-in and evening routine" width="390" height="844" fetchPriority="high" />
          <img src={asset("mood-year.png")} alt="Mood-tracker concept: a year of moods shown as a coloured calendar" width="390" height="844" />
          <img src={asset("mood-insights.png")} alt="Mood-tracker concept: mood insights and weekly patterns" width="390" height="844" />
        </div>
      </div>
      <figcaption>One idea. A whole set of screens. <a href="#gallery">Explore more concepts <span aria-hidden>↗</span></a></figcaption>
    </figure>
  );
}

export function ShowcaseLanding() {
  return (
    <div className="sf-story">
      <section id="workflow" aria-labelledby="workflow-title" className="sf-workflow">
        <div className="sf-section-intro">
          <h2 id="workflow-title">Give your next idea<br />room to take shape.</h2>
          <p>For designers, developers and founders who already build with AI — and want to explore the interface before committing to a direction.</p>
        </div>

        <article className="sf-workflow-row">
          <div className="sf-workflow-copy">
            <h3>Your project. Your agent.<br />More than one possibility.</h3>
            <p>Let your coding agent read the project, then create HTML screen concepts on the canvas. Keep alternatives side by side, compare the details and ask for another direction.</p>
            <a className="sf-text-link" href={PLUGIN_URL} target="_blank" rel="noreferrer">Connect your agent <ArrowUpRightIcon size={16} aria-hidden /></a>
          </div>
          <div className="sf-prompt-example">
            <span className="sf-example-label">Try asking your connected agent</span>
            <blockquote>“Read this project and explore three dashboard layouts. Use our styles and put each option next to the others.”</blockquote>
            <div className="sf-context-line"><span>Project context</span><span>HTML concepts</span><span>One canvas</span></div>
          </div>
        </article>

        <article className="sf-workflow-row">
          <div className="sf-workflow-copy">
            <h3>Find a reference.<br />Make the direction yours.</h3>
            <p>Explore websites and Mobbin through your agent’s browser. Bring useful references onto the board, decide what to borrow and develop a concept in your own visual language.</p>
            <p className="sf-detail">Use your own browser access. Mobbin content may require a Mobbin account.</p>
          </div>
          <div className="sf-prompt-example">
            <span className="sf-example-label">From inspiration to a brief</span>
            <blockquote>“Find references for a dense analytics screen. Take the navigation from this one, keep our typography and try two directions.”</blockquote>
            <div className="sf-context-line"><span>References</span><span>Your style</span><span>A new direction</span></div>
          </div>
        </article>

        <article className="sf-workflow-row">
          <div className="sf-workflow-copy">
            <h3>Keep the thinking<br />with the project.</h3>
            <p>Collect references, notes and concepts on a board. Save your document alongside the code and commit it with your normal Git workflow, so you can return to the ideas behind a feature.</p>
            <p className="sf-detail">You manage the commits. Git sync and merging are not automatic.</p>
          </div>
          <div className="sf-project-note">
            <GitBranchIcon size={24} weight="regular" aria-hidden />
            <p>A place for the options you tried.<br />And the reasons you chose one.</p>
            <div className="sf-note-example"><span>Decision note</span>“Keep the compact navigation from B. Use A’s overview for the first release.”</div>
          </div>
        </article>
      </section>

      <section aria-labelledby="start-title" className="sf-start" id="get-started">
        <div>
          <h2 id="start-title">Start with a question.<br />Leave with a direction.</h2>
          <p>Open the browser editor to try a concept. To work with an agent that already knows your code, use the Mac app and connect the plugin.</p>
        </div>
        <div className="sf-start-actions">
          <Link className="sf-primary-link" to="/app">Try a concept <span aria-hidden>↗</span></Link>
          <a className="sf-text-link" href={PLUGIN_URL} target="_blank" rel="noreferrer">Set up your own agent <ArrowUpRightIcon size={16} aria-hidden /></a>
        </div>
      </section>

      <section className="sf-faq" aria-labelledby="faq-title">
        <h2 id="faq-title">A few practical questions.</h2>
        <div>
          <details>
            <summary>Where does Sideform fit if I already use Figma?</summary>
            <p>Use Sideform to explore references and HTML concepts with your agent. Keep using Figma wherever it fits your design and team workflow. Try Sideform on one concept first and see whether it makes that part of the process easier.</p>
          </details>
          <details>
            <summary>Can I use the agent I already work with?</summary>
            <p>Yes. The desktop app connects to external agents through the editor plugin and MCP. Your agent needs access to the repository to read code, and browser tools to research references. <a href={PLUGIN_URL} target="_blank" rel="noreferrer">Read the setup guide.</a></p>
          </details>
          <details>
            <summary>Are the concepts production-ready code?</summary>
            <p>They are HTML prototypes for exploring a direction. Review the result and adapt it to your application before shipping. Reading project context helps guide a concept; it does not guarantee reuse of every production component.</p>
          </details>
          <details>
            <summary>How does saving in Git work?</summary>
            <p>Save the document as a file in your project and commit it with your existing tools. You control the history and branches. Sideform does not automatically sync a repository or resolve merge conflicts.</p>
          </details>
        </div>
      </section>
    </div>
  );
}
