// Types for the plain-JS policy module, so `src/lib/__tests__/cspPolicy.test.ts`
// type-checks under `tsc -b`. The module itself stays .mjs because
// `scripts/csp-serve.mjs` runs it directly under node with no build step.
export declare const BACKEND_ORIGIN: string;
export declare const POSTHOG_ORIGIN: string;
export declare const POSTHOG_ASSETS_ORIGIN: string;
export declare const ASSET_ORIGIN: string;
export declare const DIRECTIVES: Record<string, string[]>;
export declare const CONTENT_SECURITY_POLICY: string;
