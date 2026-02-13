import { useMemo } from "react";

interface SimpleMarkdownProps {
  content: string;
}

interface Block {
  type: "code" | "lines";
  lang?: string;
  text: string;
}

function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.split("\n");
  let i = 0;
  while (i < lines.length) {
    const fence = lines[i].match(/^```(\w*)$/);
    if (fence) {
      const lang = fence[1] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      blocks.push({ type: "code", lang, text: codeLines.join("\n") });
    } else {
      const textLines: string[] = [];
      while (i < lines.length && !lines[i].match(/^```/)) {
        textLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "lines", text: textLines.join("\n") });
    }
  }
  return blocks;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(
        <strong key={key++} className="font-semibold">
          {match[2]}
        </strong>
      );
    } else if (match[3]) {
      parts.push(
        <code
          key={key++}
          className="px-1 py-0.5 rounded bg-surface-elevated text-[0.85em] font-mono"
        >
          {match[3]}
        </code>
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

function renderLines(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const ulMatch = line.match(/^[-*]\s+(.+)/);
    const olMatch = line.match(/^\d+\.\s+(.+)/);

    if (ulMatch) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      nodes.push(
        <ul key={key++} className="m-0 list-disc pl-4 space-y-0.5">
          {items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    } else if (olMatch) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      nodes.push(
        <ol key={key++} className="m-0 list-decimal pl-4 space-y-0.5">
          {items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ol>
      );
    } else if (line.trim() === "") {
      nodes.push(<br key={key++} />);
      i++;
    } else {
      nodes.push(
        <p key={key++} className="m-0">
          {renderInline(line)}
        </p>
      );
      i++;
    }
  }
  return nodes;
}

export function SimpleMarkdown({ content }: SimpleMarkdownProps) {
  const rendered = useMemo(() => {
    const blocks = parseBlocks(content);
    return blocks.map((block, i) => {
      if (block.type === "code") {
        return (
          <pre
            key={i}
            className="m-0 rounded bg-surface-elevated p-2 overflow-x-auto text-xs font-mono"
          >
            <code>{block.text}</code>
          </pre>
        );
      }
      return <div key={i}>{renderLines(block.text)}</div>;
    });
  }, [content]);

  return <div className="space-y-1.5 text-[13px] leading-relaxed">{rendered}</div>;
}
