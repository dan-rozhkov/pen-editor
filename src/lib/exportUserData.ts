import { fetchAgentMemory } from "@/lib/agentMemoryApi";
import { saveBlob } from "@/lib/downloadFile";
import { getDoc, listDocs } from "@/lib/docs/docStore";
import { listUserSkills } from "@/lib/userSkills";
import { getWorkflow, listWorkflows } from "@/lib/workflows/workflowStore";
import { listSchedules } from "@/lib/workflows/workflowSchedule";

export type ExportPart<T> = T | { error: string };

export interface UserDataExport {
  exportedAt: string;
  docs: ExportPart<unknown[]>;
  workflows: ExportPart<unknown[]>;
  workflowSchedules: ExportPart<unknown[]>;
  skills: ExportPart<unknown[]>;
  memory: ExportPart<unknown>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function local<T>(read: () => T): ExportPart<T> {
  try {
    return read();
  } catch (e) {
    return { error: message(e) };
  }
}

/** Everything the user owns, as one JSON-able object. A failed part holds `{ error }` and never blocks the rest. */
export async function buildUserDataExport(now: Date = new Date()): Promise<UserDataExport> {
  const [skills, memory] = await Promise.all([
    listUserSkills().then(
      (r): ExportPart<unknown[]> => (r.ok ? r.data.skills : { error: r.error }),
      (e): ExportPart<unknown[]> => ({ error: message(e) }),
    ),
    fetchAgentMemory().then(
      (r): ExportPart<unknown> => (r.ok ? r.data : { error: r.error }),
      (e): ExportPart<unknown> => ({ error: message(e) }),
    ),
  ]);
  return {
    exportedAt: now.toISOString(),
    docs: local(() => listDocs().flatMap((m) => getDoc(m.id) ?? [])),
    workflows: local(() => listWorkflows().flatMap((m) => getWorkflow(m.id) ?? [])),
    workflowSchedules: local(() => listSchedules()),
    skills,
    memory,
  };
}

export function exportFileName(now: Date = new Date()): string {
  return `sideform-data-${now.toISOString().slice(0, 10)}.json`;
}

/** Builds the export and saves it as `sideform-data-YYYY-MM-DD.json`. */
export async function downloadUserDataExport(now: Date = new Date()): Promise<void> {
  const data = await buildUserDataExport(now);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  saveBlob(blob, exportFileName(now));
}
