# PWA Implementation Plan

This project currently has no PWA setup. The first PWA milestone should make the frontend installable and able to load the static editor shell after one successful online visit. Durable offline design storage, conflict resolution, and backend sync are intentionally out of scope for this plan.

## Goals

- A user can visit the deployed URL once, install the app with "Add to Home Screen" / browser install prompt, and launch it from a desktop icon.
- The installed app loads the Vite React shell offline after the first successful load.
- PixiJS/WebGL canvas code and static assets are cached reliably enough for the editor to open offline.
- Online-only backend features fail with clear UI instead of looking broken.

## Phase 1: Add PWA Build Support

Use `vite-plugin-pwa` instead of hand-writing the production service worker. It integrates with Vite's hashed assets, Workbox precaching, and chunk revisioning, which matters because this app already uses Rollup `manualChunks` for large `pixi-vendor` and `react-vendor` bundles.

Files to modify:

- `package.json`
  - Add dev dependency:

    ```json
    "vite-plugin-pwa": "^latest"
    ```

  - Keep existing scripts unchanged.

- `vite.config.ts`
  - Import `VitePWA`:

    ```ts
    import { VitePWA } from "vite-plugin-pwa";
    ```

  - Add `VitePWA(...)` after `react()` in `plugins`.
  - Keep the existing `manualChunks` function for `pixi-vendor` and `react-vendor`.
  - Recommended initial config:

    ```ts
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icons/*.png", "icons/*.svg", "favicon.ico"],
      manifest: {
        name: "Pen Editor",
        short_name: "Pen",
        description: "AI-first canvas design editor.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#111111",
        theme_color: "#111111",
        orientation: "any",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
      }
    })
    ```

  - The `maximumFileSizeToCacheInBytes` value is important because the PixiJS chunk is large. Verify the actual compressed and uncompressed asset sizes after `npm run build`; increase only if the generated `pixi-vendor` file is excluded from precache.

## Phase 2: Replace Default HTML Metadata

Files to modify:

- `index.html`
  - Replace the Vite favicon:

    ```html
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    ```

  - Update the title:

    ```html
    <title>Pen Editor</title>
    ```

  - Add theme color:

    ```html
    <meta name="theme-color" content="#111111" />
    ```

  - Do not manually add a manifest link if `vite-plugin-pwa` injects it. If the project chooses a static `public/manifest.webmanifest` instead, add:

    ```html
    <link rel="manifest" href="/manifest.webmanifest" />
    ```

Files to create:

- `public/favicon.ico`
- `public/icons/icon-192.png`
- `public/icons/icon-512.png`
- `public/icons/maskable-512.png`
- `public/icons/apple-touch-icon.png`

Icon requirements:

- Use real Pen Editor branding, not `/vite.svg`.
- Maskable icon safe zone should keep the main mark within the central 80%.
- Keep icons under the same origin so they are cacheable by the service worker.

## Phase 3: Register the Service Worker in React

Files to create:

- `src/pwa/registerServiceWorker.ts`

Key content:

```ts
import { registerSW } from "virtual:pwa-register";

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  return registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent("pen:pwa-update-ready"));
    },
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent("pen:pwa-offline-ready"));
    },
    onRegisterError(error) {
      console.error("Service worker registration failed", error);
    },
  });
}
```

Files to modify:

- `src/main.tsx`
  - Import and call the registration after imports and before or after `createRoot`.
  - Keep dev-only test internals unchanged.

    ```ts
    import { registerServiceWorker } from "@/pwa/registerServiceWorker";

    registerServiceWorker();
    ```

- `src/vite-env.d.ts` or equivalent Vite type file
  - Add the virtual module type:

    ```ts
    /// <reference types="vite-plugin-pwa/client" />
    ```

TypeScript constraints:

- Avoid unused return values if ESLint flags them. Either call `registerServiceWorker();` directly or intentionally store the update function only when wiring update UI.
- Keep imports ordered according to repo convention: React, third-party, `@/`, relative.

## Phase 4: Service Worker Caching Strategy

Initial target: offline shell, not full offline collaboration or AI features.

Use Workbox precaching for build output:

- Strategy: precache with revisioned hashed filenames.
- Applies to: `index.html`, Vite JS chunks, CSS, icons, local fonts/assets emitted into `dist`.
- Why: Vite assets are content-hashed; Workbox can safely serve exact revisions and clean old caches.

Runtime route strategies:

- App navigation requests
  - Strategy: network-first with fallback to precached `/index.html`.
  - Reason: users should get new deployments when online, but installed app launches should still open offline.

- Vite hashed static assets under `/assets/`
  - Strategy: cache-first via precache, not a separate runtime cache.
  - Reason: hashed assets are immutable. The large `pixi-vendor` chunk should be cached once and reused.

- Icons and app metadata
  - Strategy: cache-first.
  - Reason: install surfaces need icons reliably.

- Backend API calls such as `/api/models`, `/api/chat`, `/api/generate-image`, and URLs resolved by `VITE_DESIGN_AGENT_BACKEND_URL` or `VITE_AI_API_URL`
  - Strategy: network-only for now.
  - Reason: stale AI/chat/model responses can create confusing editor state. Offline handling should happen in UI.

- User-imported remote images or downloaded files
  - Strategy: do not cache broadly in the first milestone.
  - Reason: cross-origin CORS, opaque response quotas, and unbounded design assets can exhaust storage. Add explicit asset persistence later when offline document editing is designed.

Optional later refinement:

- Add a small runtime stale-while-revalidate cache for same-origin, versioned, non-critical assets if the app adds static templates or local documentation.
- Do not use stale-while-revalidate for core JS chunks; a mixed old/new app shell can break React/Pixi runtime assumptions.

## Phase 5: Offline Fallback UI

The current app calls `loadModels()` on startup and falls back internally when it fails, but user-facing online-only workflows still need explicit offline states.

Files to create:

- `src/hooks/useOnlineStatus.ts`

Key content:

```ts
import { useEffect, useState } from "react";

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
```

Files to create:

- `src/components/pwa/OfflineBanner.tsx`

Key behavior:

- Small non-blocking banner or status pill in editor chrome.
- Uses theme tokens from `src/index.css`, for example `bg-surface-panel` and `text-text-muted`.
- Message should be direct:
  - Offline: "Offline. The editor shell is available; AI and backend features are disabled."
  - Update ready: "Update available" with a reload button.
- Do not cover the Pixi canvas controls or sidebars on small screens.

Files to modify:

- `src/App.tsx`
  - Render the offline banner above the canvas/UI stack.
  - Keep `PixiCanvas` mounted when offline; the banner should not replace the editor shell.
  - Hide or disable backend-dependent commands in chat/image generation components when `navigator.onLine` is false.

Backend-dependent UI to audit:

- `src/hooks/useDesignChat.ts`
- `src/lib/chatModels.ts`
- `src/lib/tools/generateImage/index.ts`
- Any component that starts chat, model selection, image generation, or external download fetches.

Offline UX rules:

- Existing in-memory design editing should continue for the current session.
- Do not promise saved offline work until IndexedDB/local persistence is implemented.
- If the user tries an AI/backend action while offline, show a local error immediately instead of letting a request hang.

## Phase 6: PixiJS/WebGL Offline Handling

The PixiJS/WebGL canvas does not need special service worker handling as long as its JS chunks and same-origin static assets are precached. It does need graceful runtime checks.

Implementation guidance:

- Ensure `pixi-vendor` is included in the Workbox precache manifest after build.
- Keep `PixiCanvas` lazy-loaded. The first online visit must load that lazy chunk before offline use is guaranteed. Testing should explicitly open the editor canvas once before going offline.
- If any Pixi renderer loads image/font/shader assets by URL, make sure they are same-origin build assets or explicitly listed in PWA caching rules.
- WebGL availability is separate from online/offline status. If WebGL context creation fails, show the existing canvas error path or add a canvas-specific fallback:
  - "WebGL is unavailable in this browser/session."
- Handle WebGL context loss independently:
  - Listen for `webglcontextlost` and `webglcontextrestored` where the Pixi application is created.
  - Offline mode should not be blamed for GPU context loss.

For the first milestone:

- The offline shell can open a blank/new design on the Pixi canvas.
- Persisting documents, imported images, and generated assets for offline editing is deferred.
- If the user reloads offline before the Pixi lazy chunk was ever loaded and cached, show the offline fallback UI instead of a blank screen.

## Phase 7: Add Install and Update UX

Files to create:

- `src/components/pwa/PwaUpdateToast.tsx`

Key behavior:

- Listen for `pen:pwa-update-ready`.
- Show a small "Update available" toast/button.
- On click, call the update function returned by `registerSW`.

Potential adjustment:

- Instead of dispatching only events from `registerServiceWorker`, store PWA state in a small Zustand store such as `src/store/pwaStore.ts` if multiple components need it.
- Keep this store separate from scene/document state.

Install prompt:

- Browser install UI is sufficient for the first implementation.
- Optionally add a later `beforeinstallprompt` listener and install button, but do not block the first PWA milestone on it.

## Phase 8: Verification and Release Checklist

Build and lint:

- `npm run lint`
- `npm run build`
- `npm run preview`

Manual browser checks:

- Open the preview URL online.
- Confirm the app title is `Pen Editor`.
- Confirm the Vite favicon is gone.
- Confirm DevTools Application tab shows:
  - Manifest loaded.
  - Service worker registered.
  - Required icons available.
  - Display mode is `standalone`.
- Confirm browser install prompt or install option is available.
- Open the app once and wait until service worker reports offline-ready.
- Confirm `dist/` contains generated service worker assets.
- Confirm Workbox precache includes:
  - `index.html`
  - main app chunk
  - `react-vendor`
  - `pixi-vendor`
  - CSS
  - icons

Offline checks:

- In DevTools, enable Offline.
- Reload `/`.
- Confirm the app shell loads.
- Confirm Pixi canvas initializes if its lazy chunk was loaded during the online visit.
- Confirm offline banner appears.
- Confirm chat/model/image generation actions show an offline message and do not spin indefinitely.
- Confirm unknown app routes fall back to `index.html` if the app uses client-side routing later.

Installed app checks:

- Install the app from Chrome/Edge.
- Launch from the desktop/app launcher icon.
- Confirm it opens standalone, not as a normal browser tab.
- Go offline and launch again.
- Confirm the static shell loads from cache.

Automated tests to add:

- Unit test for `useOnlineStatus` with `online` and `offline` events.
- Component test for `OfflineBanner`.
- Playwright test using a production preview server:
  - first load online,
  - wait for service worker,
  - set browser context offline,
  - reload,
  - assert the root editor UI and offline banner are visible.

Useful Playwright assertions:

```ts
await page.goto("/");
await page.waitForFunction(() => navigator.serviceWorker.controller);
await context.setOffline(true);
await page.reload();
await expect(page.getByText(/Offline/)).toBeVisible();
```

## Project-Specific Pitfalls

- `pixi-vendor` is large. Workbox's default file size limit can skip it, causing the offline app to load the HTML but fail when the lazy Pixi canvas chunk is requested.
- The app lazy-loads `src/pixi/PixiCanvas.tsx`. A user must visit a screen that loads the canvas before that chunk is guaranteed to be cached.
- Do not cache backend API responses in the first milestone. `/api/chat`, `/api/models`, and image generation are not useful stale data.
- Environment-based backend URLs may be cross-origin. A service worker only controls its own origin, so it cannot reliably cache or intercept every backend deployment shape.
- Avoid cache-first for `index.html`; it can trap users on old deployments. Use navigation fallback plus update prompting.
- Do not mix old HTML with new chunks. Let Workbox precaching manage revisions and cleanup.
- Do not add hand-written global types loosely. TypeScript strict mode and ESLint zero-error policy mean PWA virtual module types must be added cleanly.
- Keep PWA UI above the canvas without blocking pointer events for editor tools. The Pixi canvas occupies the full viewport and the editor uses layered absolute positioning.
- `index.html` has a dev-only `react-grab` import. Keep it dev-only; service worker code should register only in production builds unless there is a deliberate local PWA test mode.
- `public/vite.svg` should be removed only after all references are replaced. Otherwise the old Vite branding can remain in browser install metadata.
- Offline editing of real documents requires a separate storage design, likely IndexedDB plus asset blob management and backend sync conflict rules. Do not imply that static shell caching solves document persistence.
