// Scripted scenarios for the landing-page hero demo (HeroDemo.tsx).
//
// Every scenario plays the same choreography — see DEMO_BEATS — so the data
// here is only the words and the mock content of each tab. The demo is a
// drawing of the desktop app, not a recording: keep the copy to things the
// agent really does (browse_task, batch_design, doc_create, QA runs).

export type DemoTabKind = "browser" | "canvas" | "doc";

export interface DemoScenario {
  id: "designer" | "product" | "qa";
  role: string;
  prompt: string;
  browser: { url: string; title: string; cards: [string, string, string] };
  canvas: { title: string; screens: [string, string, string] };
  doc: { title: string; lines: string[] };
  /** Tool-row labels in the chat, one per tab, in DEMO_TAB_ORDER. */
  tools: { running: string; done: string }[];
  summary: string;
  /** Hue (oklch) used for the mock screens of this scenario. */
  hue: number;
}

export const DEMO_TAB_ORDER: DemoTabKind[] = ["browser", "canvas", "doc"];

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "designer",
    role: "Designer",
    prompt: "Find onboarding references on Mobbin, design ours and write down the decisions.",
    browser: {
      url: "mobbin.com/search/onboarding",
      title: "Mobbin",
      cards: ["Headspace", "Duolingo", "Revolut"],
    },
    canvas: { title: "Onboarding", screens: ["Welcome", "Goals", "Reminders"] },
    doc: {
      title: "Onboarding: design notes",
      lines: [
        "Three steps, not five. Duolingo shows that goals first works.",
        "One question per screen, large tap targets.",
        "Reminders are optional. Skip is always visible.",
        "Open question: ask for notifications on step 3?",
      ],
    },
    tools: [
      { running: "Browsing Mobbin…", done: "Saved 3 references" },
      { running: "Designing on canvas…", done: "Designed 3 screens" },
      { running: "Writing the doc…", done: "Wrote design notes" },
    ],
    summary: "Done: 3 references, 3 screens and the notes are in your tabs.",
    hue: 250,
  },
  {
    id: "product",
    role: "Product builder",
    prompt: "Compare competitor pricing pages, mock up ours and draft a one-page PRD.",
    browser: {
      url: "linear.app/pricing",
      title: "Pricing",
      cards: ["Linear", "Notion", "Figma"],
    },
    canvas: { title: "Pricing page", screens: ["Plans", "Compare", "FAQ"] },
    doc: {
      title: "PRD: pricing v2",
      lines: [
        "Goal: make the Pro plan the obvious choice.",
        "Three plans. Annual billing on by default.",
        "Feature table below the fold, like Linear.",
        "Success metric: free → Pro conversion.",
      ],
    },
    tools: [
      { running: "Reading 3 pricing pages…", done: "Compared 3 competitors" },
      { running: "Designing on canvas…", done: "Designed the pricing page" },
      { running: "Writing the PRD…", done: "Drafted the PRD" },
    ],
    summary: "Done: competitor notes, a pricing page and a PRD to review.",
    hue: 155,
  },
  {
    id: "qa",
    role: "QA tester",
    prompt: "Test sign-up on staging, mark what breaks and file a bug report.",
    browser: {
      url: "staging.acme.app/sign-up",
      title: "Sign up",
      cards: ["Email", "Password", "Submit"],
    },
    canvas: { title: "Failures", screens: ["Step 1", "Step 2 ✕", "Step 3 ✕"] },
    doc: {
      title: "Bug report: sign-up",
      lines: [
        "Submit stays disabled after a valid password.",
        "Error text overlaps the field on 375 px.",
        "Steps, screenshots and the trace are attached.",
        "Severity: blocker for the release.",
      ],
    },
    tools: [
      { running: "Running the sign-up flow…", done: "Found 2 failures" },
      { running: "Placing screenshots…", done: "Marked 2 failures" },
      { running: "Writing the bug report…", done: "Filed the bug report" },
    ],
    summary: "Done: 2 bugs reproduced, marked on the canvas and written up.",
    hue: 25,
  },
];

// One beat = one visible change. `ms` is how long the beat stays on screen.
// Beat indexes are used by HeroDemo to derive the whole view, so the order
// here IS the choreography.
export const DEMO_BEATS = [
  { id: "typing", ms: 2200 },
  { id: "sent", ms: 700 },
  { id: "browser-0", ms: 900 },
  { id: "browser-1", ms: 900 },
  { id: "browser-2", ms: 1100 },
  { id: "canvas-0", ms: 800 },
  { id: "canvas-1", ms: 800 },
  { id: "canvas-2", ms: 1100 },
  { id: "doc-0", ms: 800 },
  { id: "doc-1", ms: 800 },
  { id: "doc-2", ms: 1000 },
  { id: "summary", ms: 3600 },
] as const;

export const DEMO_LAST_BEAT = DEMO_BEATS.length - 1;

/** First beat at which a tab of this kind is open. */
export function tabOpenBeat(kind: DemoTabKind): number {
  return DEMO_BEATS.findIndex((b) => b.id === `${kind}-0`);
}

/** How far a tab's content has progressed at `beat`: -1 = not open, 0..3. */
export function tabStage(kind: DemoTabKind, beat: number): number {
  const open = tabOpenBeat(kind);
  if (beat < open) return -1;
  return Math.min(beat - open, 3);
}

export function activeTabAt(beat: number): DemoTabKind | null {
  let active: DemoTabKind | null = null;
  for (const kind of DEMO_TAB_ORDER) if (beat >= tabOpenBeat(kind)) active = kind;
  return active;
}
