# Showcase agent launcher design

## Goal

Turn the showcase hero into a direct entry point for the design agent. A visitor can describe what they want, submit the prompt, and arrive in the editor with a new agent chat already open and the prompt being sent.

## User experience

The showcase heading changes from “Pen Editor Showcase” to:

> Design, on autopilot.

The existing explanatory paragraph remains below it. A compact prompt composer appears below the description and before the showcase screens. Its visual language matches the editor’s agent composer: a white panel, subtle border and shadow, rounded corners, muted placeholder text, and the same accented arrow submit button.

The composer uses the placeholder:

> Ask the design agent to create…

The interaction rules are:

- Enter submits the prompt.
- Shift+Enter inserts a line break.
- Empty and whitespace-only prompts cannot be submitted.
- The existing “Open the editor →” link remains as a secondary action.
- Copy uses sentence case rather than camel case or title case.

The composer is responsive. It fits the existing showcase header width on desktop and remains comfortably tappable without horizontal overflow on mobile. Keyboard focus is visible.

## Prompt handoff

The showcase and editor remain separate route chunks. The showcase must not import the editor’s chat store or agent components.

On submission:

1. Trim the prompt.
2. Store it in `sessionStorage` under a dedicated, versioned handoff key.
3. Navigate from `/` to `/app`.
4. When the editor mounts, consume and immediately remove the stored prompt.
5. Create a new chat tab.
6. Queue the prompt as that tab’s launch payload.
7. Activate the Agents section and open its panel.
8. The existing chat session launch effect sends the queued prompt when ready.

The value is removed before the chat is launched so refreshing or remounting the editor cannot resend the same prompt. If storage is unavailable, submission still navigates to the editor without crashing; no automatic prompt is sent.

## Component boundaries

- `ShowcaseAgentComposer` owns the showcase textarea, keyboard behavior, disabled state, and submission callback.
- A small handoff utility owns the storage key and the write/consume operations. This keeps storage behavior independently testable and prevents the showcase from importing editor state.
- An editor bootstrap function consumes the handoff and translates it into the existing chat and sidebar store operations.
- `ShowcasePage` places the composer in the hero and navigates after a successful handoff attempt.

## Testing

Unit and component tests cover:

- the new heading and sentence-case prompt copy;
- whitespace-only prompts remaining disabled;
- Enter submission and Shift+Enter line breaks;
- storage write and one-time consumption;
- editor bootstrap creating a new tab, queuing the trimmed prompt, and opening Agents;
- graceful behavior when web storage throws.

An end-to-end showcase test submits a prompt, verifies navigation to `/app`, confirms that the Design Agent section is visible, and observes the submitted user message in the new chat. Existing showcase scrolling, lazy route splitting, and direct editor navigation remain unchanged.

