# AI Image Generation — Design Agent + Agent on Canvas

**Date:** 2026-07-01
**Status:** Approved, ready for implementation plan
**Repos touched:** `pen-editor-backend` (generation core), `pen-editor` (canvas tool + display)

## Goal

Let the AI design agent generate images:

1. **Design agent path** — the agent generates an image from a prompt and it is viewable inline in the chat.
2. **Agent-on-canvas path** — when an image is generated through the on-canvas frame agent, the image automatically becomes the image-fill of the attached/selected frame.

Generation uses a cheap OpenRouter model, configurable via env, defaulting to `google/gemini-2.5-flash-image-preview` ("Nano Banana").

## Architecture

Generation requires the OpenRouter API key, so it lives on the backend. Applying an image to the scene graph mutates the client Zustand store, so it must run client-side. This maps onto the existing split-execution model:

- **Backend-executed tool** (`execute` present, like `get_guidelines`) → pure chat display.
- **Client-executed tool** (no `execute`, handler in `src/lib/tools/`) → scene-graph mutation.

Both share one backend generation core so there is a single place that calls OpenRouter.

```
Design agent:   user → generate_image (backend execute) → { url } → chat shows image
Agent on canvas: frame button → generate_frame_image (client) → POST /api/generate-image
                 → updateNode(frameId, image fill) + { url } → frame filled + chat shows image
```

## Components

### 1. Backend generation service — `pen-editor-backend/src/services/imageGen.ts`

```ts
export async function generateImage(
  config: Config,
  prompt: string,
): Promise<{ url: string; mimeType: string }>;
```

- Calls OpenRouter **chat-completions** (`https://openrouter.ai/api/v1/chat/completions`) with
  `model: config.OPENROUTER_IMAGE_MODEL`, `modalities: ["image", "text"]`, and the prompt as the
  user message. Authorization reuses `config.OPENROUTER_API_KEY`.
- Reads the returned base64 image from `choices[0].message.images[0].image_url.url` (data URL).
  (Exact response-shape handling verified against OpenRouter image output during implementation;
  tolerate both `images[]` and an inline `data:` URL in content.)
- **Storage:**
  - If `S3_*` is configured (same vars as `src/routes/upload.ts`), decode the base64 and upload via
    the existing `uploadImage()` in `src/services/s3.ts`; return the `https://` URL.
  - Otherwise return the `data:image/...;base64,...` URL directly.
- Throws on HTTP error or when no image is present in the response.

### 2. Backend config — `pen-editor-backend/src/config.ts`

Add:

```ts
OPENROUTER_IMAGE_MODEL: z.string().default("google/gemini-2.5-flash-image-preview"),
```

No new API key — reuses `OPENROUTER_API_KEY`.

### 3. Backend route — `POST /api/generate-image` (`pen-editor-backend/src/routes/generateImage.ts`)

- Body: `{ prompt: string }`. Validated with zod.
- Returns `{ url: string }` on success; `4xx` for bad input, `5xx`/`{ error }` on generation failure.
- Thin wrapper over `generateImage(config, prompt)`. Registered in `src/app.ts` like the upload route.
- Used by the client-side `generate_frame_image` tool. CORS/registration follows the existing
  `/api/upload` route conventions.

### 4. Design-agent tool — `generate_image` (`pen-editor-backend/src/ai/tools.ts`)

```ts
generate_image: tool({
  description: "Generate an image from a text prompt and show it in the chat. Use when the user
    asks for an illustration/photo/background that is NOT being applied to a specific frame.",
  inputSchema: z.object({ prompt: z.string() }),
  execute: async ({ prompt }) => {
    try { const { url } = await generateImage(config, prompt); return { url, prompt }; }
    catch (err) { return { error: (err as Error).message }; }
  },
}),
```

- Backend-executed. Returns `{ url, prompt }`.
- `config` is captured the same way other backend-executed tools obtain it in `tools.ts`
  (verify how `config` is currently threaded into `penTools`; if tools are built per-request, pass
  `config` into the tool factory).
- Chat display needs **no** frontend change: `ToolCallIndicator.tsx` already runs `extractImageUrls`
  over tool output and renders any `url`/`data:image` with a download button.

### 5. Canvas tool — `generate_frame_image` (schema in `tools.ts`, handler in frontend)

Schema (`tools.ts`, **no `execute`** → client-executed):

```ts
generate_frame_image: tool({
  description: "Generate an image from a text prompt and set it as the image fill of the given
    frame. Use for on-canvas requests that target a specific frame.",
  inputSchema: z.object({
    prompt: z.string(),
    frame_id: z.string().describe("ID of the frame whose fill should become the generated image"),
  }),
  // no execute — handled in the browser
}),
```

Handler — `pen-editor/src/lib/tools/generateFrameImage.ts`, registered in `src/lib/toolRegistry.ts`:

```ts
export const generateFrameImage: ToolHandler = async (args) => {
  const prompt = args.prompt as string;
  const frameId = args.frame_id as string;
  const node = useSceneStore.getState().nodesById[frameId];
  if (!node) return JSON.stringify({ error: `Frame ${frameId} not found` });

  // generation goes through the backend (key lives there)
  const res = await fetch(`${apiBase}/api/generate-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) return JSON.stringify({ error: `Generation failed (${res.status})` });
  const { url } = await res.json();

  saveHistory(/* current snapshot */);
  useSceneStore.getState().updateNode(frameId, {
    fills: [createImagePaint({ url, mode: "fill" })],
    ...clearLegacyFillProps(),
  });
  return JSON.stringify({ success: true, url, frame_id: frameId });
};
```

- `apiBase` resolves the same way `useDesignChat.ts` resolves the backend URL
  (`VITE_AI_API_URL` / `VITE_DESIGN_AGENT_BACKEND_URL`, default same-origin).
- Returning `url` means the image also shows in chat via `ToolCallIndicator`.
- History is saved before the mutation (matches `batchDesign` pattern) so the fill is undoable.

### 6. Wiring the on-canvas agent

- `FrameAgentButton` → `launchFrameAgentChat(frameId, text)` already attaches the frame and opens
  the agent panel. No new button.
- **System prompt** (`pen-editor-backend/src/ai/system-prompt.ts`): add a short section documenting
  both tools — use `generate_frame_image` (with the target frame id) when a request is about filling
  a specific frame on the canvas; use `generate_image` for standalone chat images.
- The frame id is available to the model through the existing `canvasContext`/selection; the
  on-canvas launch text references the target frame so the model passes the correct `frame_id`.

## Error handling

| Failure | Behavior |
|---|---|
| OpenRouter HTTP error / no image returned | Service throws → `generate_image` returns `{ error }`; route returns 5xx; `generate_frame_image` returns an error string and does **not** mutate the frame. |
| `frame_id` missing / node not found | `generate_frame_image` returns `{ error }`, no mutation. |
| Bad request body to route | 400 with message. |

## Testing

Mirrors the existing split suites (no real LLM / no real OpenRouter):

**Backend** (`pen-editor-backend/test/`, Vitest):
- Unit-test `generateImage()` with mocked `fetch`: asserts request shape (model, modalities, auth)
  and covers both storage branches (S3 configured → https URL via mocked `uploadImage`; not
  configured → data URL) and the no-image error path.
- Zod-schema contract test extended for `generate_image` and `generate_frame_image` in `penTools`.
- Route test for `/api/generate-image` with `generateImage` mocked: success `{ url }` and failure.

**Frontend** (`pen-editor/src/**/__tests__/`, Vitest + happy-dom):
- Handler test for `generate_frame_image`: stub `fetch` to return `{ url }`, seed a frame via
  `seedScene()`, call the handler, assert the frame's `fills` now contains an image paint with that
  url and legacy fill props are cleared. Cover the frame-not-found and fetch-failure paths (no
  mutation).
- Update `pen-editor/src/lib/__tests__/toolContract.test.ts`: `generate_frame_image` joins the
  client registry ∩ penTools set; `generate_image` is backend-executed and excluded exactly like
  `get_guidelines` (confirm the test's exclusion mechanism for execute-bearing tools and extend if
  needed).

## Scope / YAGNI

- v1 is **text-to-image only**.
- **Follow-up (not built):** image-to-image edits — feed the frame screenshot as a reference image
  so "make this frame's background a sunset" edits the existing content. Gemini Flash Image supports
  this; deferred.
- No new on-canvas button; reuse the existing frame agent affordance.
- No asset/library store changes — image URLs (data or https) live directly on the node fill, as
  they already do elsewhere in the scene graph.

## Tool-name contract reminder

`penTools` (backend) gains `generate_image` + `generate_frame_image`. `toolRegistry.ts` (frontend)
gains only `generate_frame_image`. The contract test must keep treating execute-bearing backend
tools (`generate_image`) as backend-only.
