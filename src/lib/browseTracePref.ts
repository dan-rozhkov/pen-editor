import { createStorageFlag } from "@/lib/storageSync";

/** localStorage key: "all" records a trace for every browse_agent run; absent = QA runs only (the default). */
export const BROWSE_TRACES_KEY = "pen.browseTraces";

export const traceFlag = createStorageFlag(BROWSE_TRACES_KEY, { onValue: "all" });

/** Read at run time, so a change made in the Settings tab applies to the next run. */
export const tracesForAllRuns = traceFlag.get;
export const setTracesForAllRuns = traceFlag.set;
/** useSyncExternalStore subscribe. */
export const subscribeTracesForAllRuns = traceFlag.subscribe;
