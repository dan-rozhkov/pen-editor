import { useEffect, useRef, useState, type CSSProperties } from "react";

import {
  BrowserIcon,
  CheckIcon,
  FileTextIcon,
  PenNibIcon,
  SparkleIcon,
  type Icon,
} from "@/components/icons";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

import {
  DEMO_BEATS,
  DEMO_LAST_BEAT,
  DEMO_SCENARIOS,
  DEMO_TAB_ORDER,
  activeTabAt,
  tabStage,
  type DemoScenario,
  type DemoTabKind,
} from "./demoScenarios";

const TAB_META: Record<DemoTabKind, { icon: Icon; label: (s: DemoScenario) => string }> = {
  browser: { icon: BrowserIcon, label: (s) => s.browser.title },
  canvas: { icon: PenNibIcon, label: (s) => s.canvas.title },
  doc: { icon: FileTextIcon, label: (s) => s.doc.title },
};

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * A drawing of the desktop app playing one scenario: the agent opens a
 * browser tab, a canvas tab and a doc tab in turn. Pure presentation, no
 * real editor code. Pauses while off screen; with reduced motion it shows
 * the finished state and never advances by itself.
 */
export function HeroDemo() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [beat, setBeat] = useState(() => (prefersReducedMotion() ? DEMO_LAST_BEAT : 0));
  const [visible, setVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const scenario = DEMO_SCENARIOS[scenarioIndex]!;

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? true));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || prefersReducedMotion()) return;
    const timer = window.setTimeout(() => {
      if (beat < DEMO_LAST_BEAT) {
        setBeat(beat + 1);
      } else {
        setScenarioIndex((i) => (i + 1) % DEMO_SCENARIOS.length);
        setBeat(0);
      }
    }, DEMO_BEATS[beat]!.ms);
    return () => window.clearTimeout(timer);
  }, [beat, visible]);

  function selectScenario(index: number) {
    track("landing_demo_scenario_selected", { scenario: DEMO_SCENARIOS[index]!.id });
    setScenarioIndex(index);
    setBeat(prefersReducedMotion() ? DEMO_LAST_BEAT : 0);
  }

  const active = activeTabAt(beat);
  const openTabs = DEMO_TAB_ORDER.filter((kind) => tabStage(kind, beat) >= 0);
  const style = { "--demo-hue": scenario.hue } as CSSProperties;

  return (
    <div className="sf-demo" ref={rootRef} style={style}>
      <div className="sf-demo-roles" role="group" aria-label="Choose a scenario">
        {DEMO_SCENARIOS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={i === scenarioIndex}
            onClick={() => selectScenario(i)}
          >
            {s.role}
          </button>
        ))}
      </div>

      <figure className="sf-demo-window" aria-label={`Sideform desktop app. Scenario: ${scenario.role}. ${scenario.prompt}`}>
        <div className="sf-demo-titlebar" aria-hidden>
          <span className="sf-demo-lights"><i /><i /><i /></span>
          <span>Sideform</span>
        </div>
        <div className="sf-demo-body" aria-hidden>
          <ChatPane scenario={scenario} beat={beat} />
          <div className="sf-demo-workspace">
            <div className="sf-demo-tabs">
              {openTabs.length === 0 && <span className="sf-demo-tab-empty">No tabs yet</span>}
              {openTabs.map((kind) => {
                const { icon: TabIcon, label } = TAB_META[kind];
                return (
                  <span key={`${scenario.id}-${kind}`} className={cn("sf-demo-tab", kind === active && "is-active")}>
                    <TabIcon size={13} weight="regular" />
                    {label(scenario)}
                  </span>
                );
              })}
            </div>
            <div className="sf-demo-stage">
              <MobileStatus scenario={scenario} beat={beat} />
              {active === null && <EmptyWorkspace typing={beat === 0} />}
              {active === "browser" && <BrowserTab scenario={scenario} stage={tabStage("browser", beat)} />}
              {active === "canvas" && <CanvasTab scenario={scenario} stage={tabStage("canvas", beat)} />}
              {active === "doc" && <DocTab scenario={scenario} stage={tabStage("doc", beat)} />}
            </div>
          </div>
        </div>
      </figure>
    </div>
  );
}

function ChatPane({ scenario, beat }: { scenario: DemoScenario; beat: number }) {
  const sent = beat >= 1;
  return (
    <div className="sf-demo-chat">
      <div className="sf-demo-chat-head"><SparkleIcon size={13} weight="fill" /> Sideform Agent</div>
      <div className="sf-demo-chat-log">
        {sent && <p className="sf-demo-user">{scenario.prompt}</p>}
        {DEMO_TAB_ORDER.map((kind, i) => {
          const stage = tabStage(kind, beat);
          if (stage < 0) return null;
          const tool = scenario.tools[i]!;
          const done = stage >= 2;
          return (
            <p key={`${scenario.id}-${kind}`} className={cn("sf-demo-tool", done && "is-done")}>
              {done ? <CheckIcon size={12} weight="bold" /> : <span className="sf-demo-spinner" />}
              {done ? tool.done : tool.running}
            </p>
          );
        })}
        {beat >= DEMO_LAST_BEAT && <p className="sf-demo-agent">{scenario.summary}</p>}
      </div>
      <div className="sf-demo-composer">
        {beat === 0 ? (
          <TypedText key={scenario.id} text={scenario.prompt} />
        ) : (
          <span className="sf-demo-placeholder">Ask the agent…</span>
        )}
      </div>
    </div>
  );
}

/** Phone width has no chat pane: one line tells what the agent is doing. */
function MobileStatus({ scenario, beat }: { scenario: DemoScenario; beat: number }) {
  let text = beat === 0 ? scenario.prompt : "Thinking…";
  DEMO_TAB_ORDER.forEach((kind, i) => {
    const stage = tabStage(kind, beat);
    if (stage >= 0) text = stage >= 2 ? scenario.tools[i]!.done : scenario.tools[i]!.running;
  });
  if (beat >= DEMO_LAST_BEAT) text = scenario.summary;
  return (
    <p className="sf-demo-mobile-status">
      <SparkleIcon size={12} weight="fill" /> {text}
    </p>
  );
}

function EmptyWorkspace({ typing }: { typing: boolean }) {
  return (
    <div className="sf-demo-empty">
      <SparkleIcon size={22} weight="regular" />
      <span>{typing ? "Describe the task once." : "The agent picks the right app…"}</span>
    </div>
  );
}

const PICKED_BY_STAGE = [0, 1, 3, 3];

function BrowserTab({ scenario, stage }: { scenario: DemoScenario; stage: number }) {
  const picked = PICKED_BY_STAGE[stage] ?? 3;
  return (
    <div className="sf-demo-browser">
      <div className="sf-demo-url">{scenario.browser.url}</div>
      <div className="sf-demo-sites">
        {scenario.browser.cards.map((name, i) => (
          <div key={name} className={cn("sf-demo-site", i < picked && "is-picked", stage === 0 && "is-loading")}>
            <div className="sf-demo-site-shot" style={{ "--i": i } as CSSProperties}><i /><i /><i /></div>
            <span>{name}</span>
            {i < picked && <em>{scenario.id === "qa" && i > 0 ? "Failed" : "Saved"}</em>}
          </div>
        ))}
      </div>
      <svg
        className="sf-demo-cursor"
        data-stage={Math.min(stage, 2)}
        width="18"
        height="18"
        viewBox="0 0 18 18"
      >
        <path d="M2 1l13 7-6 1.6L6.4 16z" />
      </svg>
    </div>
  );
}

function CanvasTab({ scenario, stage }: { scenario: DemoScenario; stage: number }) {
  return (
    <div className="sf-demo-canvas">
      {scenario.canvas.screens.map((name, i) =>
        i <= stage ? (
          <div key={name} className={cn("sf-demo-screen", i === Math.min(stage, 2) && stage < 3 && "is-selected")}>
            <span className="sf-demo-screen-name">{name}</span>
            <div className="sf-demo-phone" style={{ "--i": i } as CSSProperties}>
              <i /><i /><i /><i />
              {scenario.id === "qa" && i > 0 && <b className="sf-demo-flag">!</b>}
            </div>
          </div>
        ) : (
          <div key={name} className="sf-demo-screen is-placeholder"><div className="sf-demo-phone" /></div>
        ),
      )}
    </div>
  );
}

function DocTab({ scenario, stage }: { scenario: DemoScenario; stage: number }) {
  const shown = Math.min(scenario.doc.lines.length, (stage + 1) * 2);
  return (
    <div className="sf-demo-doc">
      <h4>{scenario.doc.title}</h4>
      <ul>
        {scenario.doc.lines.slice(0, shown).map((line) => <li key={line}>{line}</li>)}
      </ul>
    </div>
  );
}

/** Types `text` out over ~1.8 s. With reduced motion it shows it whole. */
function TypedText({ text }: { text: string }) {
  const [count, setCount] = useState(() => (prefersReducedMotion() ? text.length : 0));
  useEffect(() => {
    if (count >= text.length) return;
    const step = Math.max(1, Math.ceil(text.length / 60));
    const timer = window.setTimeout(() => setCount((c) => Math.min(text.length, c + step)), 30);
    return () => window.clearTimeout(timer);
  }, [count, text]);
  return (
    <span className="sf-demo-typing">
      {text.slice(0, count)}
      <span className="sf-demo-caret" />
    </span>
  );
}
