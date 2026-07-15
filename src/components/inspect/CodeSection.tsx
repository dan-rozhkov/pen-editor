import { useMemo, useRef, useState, useEffect } from "react";
import clsx from "clsx";
import { CopyIcon, CheckIcon } from "@phosphor-icons/react";
import { useSceneStore } from "@/store/sceneStore";
import { useDevModeStore, type CodegenFormat, type CodegenReactStyle } from "@/store/devModeStore";
import { buildCssCode } from "@/lib/codegen/css";
import { buildTailwindCode } from "@/lib/codegen/tailwind";
import { buildReactCode } from "@/lib/codegen/react";
import { highlightCode, type Token } from "@/lib/codegen/highlight";
import { writeTextToClipboard } from "@/utils/clipboard";
import { ButtonGroup } from "@/components/ui/button-group";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { SelectWithOptions } from "@/components/ui/select";

const FORMAT_OPTIONS: { value: CodegenFormat; label: string }[] = [
  { value: "css", label: "CSS" },
  { value: "tailwind", label: "Tailwind" },
  { value: "react", label: "React" },
];

const MAX_COLLAPSED_LINES = 40;

const TOKEN_CLASS: Record<Token["kind"], string> = {
  keyword: "text-purple-400",
  string: "text-green-400",
  comment: "text-text-muted italic",
  number: "text-orange-400",
  punctuation: "text-text-muted",
  plain: "text-text-primary",
  property: "text-blue-400",
  tag: "text-red-400",
  className: "text-yellow-400",
};

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(resetTimeoutRef.current), []);

  const handleCopy = async () => {
    const ok = await writeTextToClipboard(code);
    if (!ok) return;
    setCopied(true);
    clearTimeout(resetTimeoutRef.current);
    resetTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <IconButton type="button" variant="ghost" size="icon-sm" tooltip="Copy code" onClick={handleCopy}>
      {copied ? <CheckIcon size={14} weight="bold" /> : <CopyIcon size={14} />}
    </IconButton>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: "css" | "html" | "tsx" }) {
  const [expanded, setExpanded] = useState(false);

  const lines = useMemo(() => code.split("\n"), [code]);
  const isLong = lines.length > MAX_COLLAPSED_LINES;
  const visibleCode = isLong && !expanded ? lines.slice(0, MAX_COLLAPSED_LINES).join("\n") : code;

  const tokens = useMemo(() => highlightCode(visibleCode, lang), [visibleCode, lang]);

  return (
    <div className="relative rounded-md bg-surface-elevated border border-border-default">
      <div className="absolute top-1 right-1">
        <CopyButton code={code} />
      </div>
      <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-words p-3 pr-8 overflow-x-auto">
        {tokens.map((token, i) => (
          <span key={i} className={TOKEN_CLASS[token.kind]}>
            {token.text}
          </span>
        ))}
      </pre>
      {isLong && (
        <div className="px-3 pb-2">
          <button
            type="button"
            className="text-[11px] text-text-muted hover:text-text-primary underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Show less" : `Show all (${lines.length} lines)`}
          </button>
        </div>
      )}
    </div>
  );
}

const REACT_STYLE_OPTIONS: { value: CodegenReactStyle; label: string }[] = [
  { value: "inline", label: "Inline" },
  { value: "tailwind", label: "Tailwind" },
];

export function CodeSection({ selectedIds }: { selectedIds: string[] }) {
  const nodesById = useSceneStore((s) => s.nodesById);
  const childrenById = useSceneStore((s) => s.childrenById);
  const units = useDevModeStore((s) => s.units);
  const remBase = useDevModeStore((s) => s.remBase);
  const format = useDevModeStore((s) => s.codegenFormat);
  const setFormat = useDevModeStore((s) => s.setCodegenFormat);
  const reactStyle = useDevModeStore((s) => s.codegenReactStyle);
  const setReactStyle = useDevModeStore((s) => s.setCodegenReactStyle);

  const result = useMemo(() => {
    if (selectedIds.length === 0) return null;
    const options = { units, remBase };
    if (format === "css") {
      return buildCssCode(selectedIds, nodesById, options);
    }
    const nodeId = selectedIds[0];
    if (format === "tailwind") {
      return buildTailwindCode(nodeId, nodesById, childrenById, options);
    }
    return buildReactCode(nodeId, nodesById, childrenById, { ...options, styleMode: reactStyle });
  }, [selectedIds, nodesById, childrenById, units, remBase, format, reactStyle]);

  if (selectedIds.length === 0 || !result) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 text-center">
        <span className="text-text-muted text-xs">Select a layer to inspect</span>
      </div>
    );
  }

  const lang: "css" | "html" | "tsx" = format === "css" ? "css" : format === "tailwind" ? "html" : "tsx";

  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
      <div className={clsx("flex items-center gap-1.5", format === "react" && "flex-wrap")}>
        <SelectWithOptions
          size="sm"
          value={format}
          onValueChange={(v) => v && setFormat(v as CodegenFormat)}
          options={FORMAT_OPTIONS}
          className="w-28"
        />
        {format === "react" && (
          <ButtonGroup>
            {REACT_STYLE_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant={reactStyle === opt.value ? "default" : "outline"}
                size="sm"
                onClick={() => setReactStyle(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </ButtonGroup>
        )}
      </div>

      <CodeBlock code={result.code} lang={lang} />

      {result.warnings.length > 0 && (
        <div className="text-[11px] text-text-muted">{result.warnings.join(" ")}</div>
      )}
    </div>
  );
}
