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

function isTableSeparatorLine(line: string): boolean {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

function isTableRowLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && trimmed.startsWith("|") && trimmed.endsWith("|");
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderLines(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    const hrMatch = line.match(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/);
    const ulMatch = line.match(/^[-*]\s+(.+)/);
    const olMatch = line.match(/^\d+\.\s+(.+)/);
    const isTableStart =
      isTableRowLine(line) &&
      i + 1 < lines.length &&
      isTableSeparatorLine(lines[i + 1]);

    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 6);
      const textContent = headingMatch[2];
      const classesByLevel: Record<number, string> = {
        1: "m-0 mt-1.5 mb-1 text-[18px] leading-tight font-semibold",
        2: "m-0 mt-1.5 mb-1 text-[16px] leading-tight font-semibold",
        3: "m-0 mt-1 mb-0.5 text-[14px] leading-snug font-semibold",
        4: "m-0 mt-1 mb-0.5 text-[13px] leading-snug font-semibold",
        5: "m-0 mt-1 mb-0.5 text-[12px] leading-snug font-semibold uppercase tracking-wide text-text-secondary",
        6: "m-0 mt-1 mb-0.5 text-[12px] leading-snug font-semibold uppercase tracking-wide text-text-secondary",
      };
      const headingClass = classesByLevel[level] ?? classesByLevel[4];
      if (level === 1) {
        nodes.push(<h1 key={key++} className={headingClass}>{renderInline(textContent)}</h1>);
      } else if (level === 2) {
        nodes.push(<h2 key={key++} className={headingClass}>{renderInline(textContent)}</h2>);
      } else if (level === 3) {
        nodes.push(<h3 key={key++} className={headingClass}>{renderInline(textContent)}</h3>);
      } else if (level === 4) {
        nodes.push(<h4 key={key++} className={headingClass}>{renderInline(textContent)}</h4>);
      } else if (level === 5) {
        nodes.push(<h5 key={key++} className={headingClass}>{renderInline(textContent)}</h5>);
      } else {
        nodes.push(<h6 key={key++} className={headingClass}>{renderInline(textContent)}</h6>);
      }
      i++;
    } else if (hrMatch) {
      nodes.push(
        <hr
          key={key++}
          className="my-2 border-0 border-t border-border-default/80"
        />
      );
      i++;
    } else if (isTableStart) {
      const header = parseTableRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];

      while (i < lines.length && isTableRowLine(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }

      nodes.push(
        <div key={key++} className="overflow-x-auto">
          <table className="w-full border-collapse leading-snug">
            <thead>
              <tr className="border-b border-border-default">
                {header.map((cell, j) => (
                  <th
                    key={j}
                    className="px-1.5 py-1 text-left align-top font-semibold"
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className="border-b border-border-default last:border-b-0"
                >
                  {row.map((cell, j) => (
                    <td key={j} className="px-1.5 py-1 align-top">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } else if (ulMatch) {
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
