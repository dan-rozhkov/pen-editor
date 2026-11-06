import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { webCanvasStore, subscribeWebCanvases } from "@/lib/canvases/webCanvasStore";
import { listDocs, subscribeDocs, deleteDoc } from "@/lib/docs/docStore";
import { listWorkflows, subscribeWorkflows, deleteWorkflow } from "@/lib/workflows/workflowStore";
import { sortRecent, type RecentItem } from "@/lib/workspace/recent";

const RELOAD_COALESCE_MS = 50;

async function loadAll(): Promise<RecentItem[]> {
  const items: RecentItem[] = [];
  // Each store is independent: one that fails contributes nothing and hides nothing else.
  try {
    const res = await webCanvasStore.list();
    if ("canvases" in res) {
      for (const c of res.canvases) items.push({ kind: "canvas", id: c.id, title: c.title, updatedAt: c.updatedAt });
    }
  } catch {
    /* ignore */
  }
  try {
    for (const d of listDocs()) items.push({ kind: "doc", id: d.id, title: d.title, updatedAt: d.updatedAt });
  } catch {
    /* ignore */
  }
  try {
    for (const w of listWorkflows()) items.push({ kind: "workflow", id: w.id, title: w.title, updatedAt: w.updatedAt });
  } catch {
    /* ignore */
  }
  return sortRecent(items);
}

/** Removes one item from its store. Returns false when the store refused. */
export async function removeRecentItem(item: Pick<RecentItem, "kind" | "id">): Promise<boolean> {
  try {
    if (item.kind === "canvas") {
      const res = await webCanvasStore.remove(item.id);
      if ("error" in res) {
        toast.error(res.error);
        return false;
      }
      return true;
    }
    if (item.kind === "doc") deleteDoc(item.id, "editor");
    else deleteWorkflow(item.id, "editor");
    return true;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** Canvases, documents and workflows merged, newest first; refreshes on any change. */
export function useRecentItems(): { items: RecentItem[]; reload: () => void } {
  const [items, setItems] = useState<RecentItem[]>([]);
  const [tick, setTick] = useState(0);
  // A bulk delete fires one store event per item: one reload covers the burst.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reload = useCallback(() => {
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setTick((n) => n + 1);
    }, RELOAD_COALESCE_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void loadAll().then((next) => {
      if (!cancelled) setItems(next);
    });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    const offs = [subscribeWebCanvases(reload), subscribeDocs(reload), subscribeWorkflows(reload)];
    return () => offs.forEach((off) => off());
  }, [reload]);

  return { items, reload };
}
