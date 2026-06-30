# Project TODO / Backlog

Cross-cutting follow-ups that don't yet have their own spec. Newest first.

## Image generation bloats the model context → chat gets expensive

**Added:** 2026-07-01

**Problem.** Generated images currently come back as `data:image/...;base64,...` URLs
(the fallback whenever S3 is not configured). Those base64 blobs end up in:

- the `generate_image` / `generate_frame_image` **tool results** in the chat history, and
- the frame's `fills[].image.url` that gets serialized into the **`canvasContext`** sent
  with every turn (when the agent reads the scene).

Because the whole message history + canvasContext is re-sent to the model on every
subsequent turn, each generated image adds tens-to-hundreds of KB of base64 that is
re-tokenized again and again. After a couple of generations the chat context balloons,
turns get slow, cost rises sharply, and we risk hitting the context window.

**Candidate solutions (decide in a spec):**

1. **Prefer hosted URLs over data URLs.** Configure/require `S3_*` so `generateImage()`
   uploads and returns a short `https://` URL instead of base64. Biggest win, already
   half-built (`src/services/imageGen.ts` + `src/services/s3.ts`). Needs an S3 bucket.
2. **Strip base64 from history before sending to the model.** On the backend, when
   building `modelMessages`, replace any `data:image/...;base64,...` in prior tool
   results with a short placeholder (e.g. `[generated image #N]`) — the browser already
   rendered the real image, the model doesn't need the bytes back.
3. **Truncate image fills in `canvasContext`.** When serializing editor state for the
   model, drop/elide `data:` URLs in `fills`/`imageFill` so a filled frame doesn't
   re-inject its whole image every turn.

Likely a combination of (2) + (3) for the no-S3 case, with (1) as the production path.

**Why it matters:** directly affects per-message cost and latency of the design-agent
chat once images are in play. See `docs/superpowers/specs/2026-07-01-image-generation-design.md`.
