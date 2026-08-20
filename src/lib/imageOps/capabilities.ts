// Thin re-export so UI code that only cares about image-op availability
// doesn't need to import the chat-specific chatModels.ts module directly.
// Source of truth (caching, GET /api/models fetch, conservative false
// default until the backend responds) lives there — see its comments near
// `visionFallback`/`canSendImages` for the same pattern this mirrors.
export { canRemoveBackground, canVectorize } from "@/lib/chatModels";
