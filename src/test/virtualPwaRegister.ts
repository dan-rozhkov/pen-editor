// Test-only stand-in for the "virtual:pwa-register" module that
// vite-plugin-pwa injects at build time. It isn't resolvable under Vitest's
// standalone config (VitePWA isn't part of vitest.config.ts), so
// vitest.config.ts aliases the real specifier to this file. Import
// `registerSW` from here in tests to assert on calls / control return values.
import { vi } from "vitest";

export const registerSW = vi.fn();
