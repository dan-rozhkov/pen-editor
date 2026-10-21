import { LockIcon } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";

import { OpenCodeKeyDialog } from "@/components/chat/OpenCodeKeyDialog";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useChatBootstrap } from "@/hooks/useChatBootstrap";
import { useModelOptions } from "@/hooks/useModelOptions";
import { hasOpenCodeKey, subscribeOpenCodeKey } from "@/lib/opencodeKey";
import { promptSuggestionsFlag } from "@/lib/promptSuggestion";
import { useChatStore } from "@/store/chatStore";
import { useOpenCodeKeyDialogStore } from "@/store/openCodeKeyDialogStore";

import { SettingsGroup, SettingsSection } from "../SettingsSection";

const PARALLEL_OPTIONS = [
  { value: "1", label: "x1" },
  { value: "2", label: "x2" },
  { value: "3", label: "x3" },
] as const;

export function AgentSection() {
  useChatBootstrap();
  const model = useChatStore((s) => s.model);
  const setModel = useChatStore((s) => s.setModel);
  const parallelCount = useChatStore((s) => s.parallelCount);
  const setParallelCount = useChatStore((s) => s.setParallelCount);
  const options = useModelOptions();
  const hasKey = useSyncExternalStore(subscribeOpenCodeKey, hasOpenCodeKey, hasOpenCodeKey);
  const suggestionsOn = useSyncExternalStore(promptSuggestionsFlag.subscribe, promptSuggestionsFlag.get, () => true);
  const dialogOpen = useOpenCodeKeyDialogStore((s) => s.open);
  const setDialogOpen = useOpenCodeKeyDialogStore((s) => s.setOpen);

  const anyLocked = !hasKey && options.some((o) => o.requiresUserKey);

  return (
    <SettingsSection title="AI agent">
      <SettingsGroup
        inline
        title="Default model"
        description={anyLocked ? "Models with a lock need an OpenCode API key." : "The model new chat messages use."}
      >
        <Select value={model} onValueChange={(next) => next && setModel(next)}>
          <SelectTrigger aria-label="Default model" className="w-52">
            <SelectValue>{options.find((o) => o.value === model)?.label ?? model}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="end" className="w-64">
            {options.map((option) => {
              const locked = Boolean(option.requiresUserKey) && !hasKey;
              return (
                <SelectItem key={option.value} value={option.value} disabled={locked}>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate">{option.label}</span>
                    {locked && <LockIcon size={12} weight="light" className="shrink-0 text-text-muted" />}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </SettingsGroup>
      <SettingsGroup
        inline
        title="OpenCode API key"
        description={hasKey ? "A key is saved in this browser." : "Not set. Unlocks the OpenCode models."}
      >
        <Button variant="outline" onClick={() => setDialogOpen(true)}>
          {hasKey ? "Change key" : "Add key"}
        </Button>
      </SettingsGroup>
      <SettingsGroup inline title="Parallel agents" description="Run one message in several chats at once.">
        <SegmentedControl
          aria-label="Parallel agents"
          options={PARALLEL_OPTIONS}
          value={String(parallelCount) as "1" | "2" | "3"}
          onValueChange={(next) => setParallelCount(Number(next) as 1 | 2 | 3)}
        />
      </SettingsGroup>
      <SettingsGroup inline title="Prompt suggestions" description="Suggest a next message after the agent replies.">
        <Switch
          aria-label="Prompt suggestions"
          checked={suggestionsOn}
          onCheckedChange={promptSuggestionsFlag.set}
        />
      </SettingsGroup>
      {/* Mounted once, as in ChatPanel: this page has no composer to host it. */}
      <OpenCodeKeyDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </SettingsSection>
  );
}
