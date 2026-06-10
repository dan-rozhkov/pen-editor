import type { UIMessage } from "ai";
import { isToolUIPart, getToolName } from "ai";
import { getToolDisplayName } from "@/lib/toolDisplayNames";

const MAX_BLOCK_CHARS = 4000;
const DATA_IMAGE_RE = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Strip base64 image payloads so we never dump huge data URLs into markdown. */
function stripDataImages(value: string): string {
  return value.replace(DATA_IMAGE_RE, "[data-url omitted]");
}

/** Pretty-print a value as JSON; if it is already a JSON string, parse then re-stringify. */
function prettyJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Build a ```json fenced block, sanitizing data URLs and truncating if oversized. */
function jsonBlock(label: string, value: unknown): string {
  let body = stripDataImages(prettyJson(value));
  if (body.length > MAX_BLOCK_CHARS) {
    body = `${body.slice(0, MAX_BLOCK_CHARS)}\n… [truncated]`;
  }
  return `${label}\n\`\`\`json\n${body}\n\`\`\``;
}

type AnyToolPart = {
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function toolPartToMarkdown(part: unknown): string {
  const name = getToolName(part as never);
  const tp = part as AnyToolPart;
  const lines: string[] = [`**Tool:** ${getToolDisplayName(name)}`];

  if (tp.input !== undefined) {
    lines.push(jsonBlock("Input", tp.input));
  }
  if (tp.output !== undefined) {
    lines.push(jsonBlock("Output", tp.output));
  }
  if (tp.errorText) {
    lines.push(`**Error:** ${tp.errorText}`);
  }
  return lines.join("\n\n");
}

/** Serialize a single chat message to Markdown. */
export function messageToMarkdown(msg: UIMessage): string {
  const sections: string[] = [`## ${capitalize(msg.role)}`];

  for (const part of msg.parts) {
    if (part.type === "text" && part.text) {
      sections.push(part.text);
      continue;
    }
    if (part.type === "reasoning" && part.text) {
      const quoted = part.text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      sections.push(`> **Thinking:**\n${quoted}`);
      continue;
    }
    if (part.type === "file") {
      const fp = part as { mediaType?: string; url?: string };
      if (typeof fp.mediaType === "string" && fp.mediaType.startsWith("image/")) {
        const url = fp.url ?? "";
        if (url.startsWith("data:")) {
          sections.push("*[attached image]*");
        } else {
          sections.push(`![image](${url})`);
        }
      }
      continue;
    }
    if (isToolUIPart(part)) {
      sections.push(toolPartToMarkdown(part));
      continue;
    }
  }

  return sections.join("\n\n");
}

/** Serialize an entire chat (list of messages) to a Markdown document. */
export function chatToMarkdown(messages: UIMessage[], title?: string): string {
  const header = `# ${title || "Chat"}`;
  const body = messages.map(messageToMarkdown).join("\n\n---\n\n");
  return body ? `${header}\n\n${body}` : header;
}

/** Make a string safe for use as a filename. */
export function sanitizeFilename(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

/** Compact `YYYYMMDD-HHmmss` timestamp for filenames. */
function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function chatFilename(title?: string): string {
  return `chat-${sanitizeFilename(title || "chat")}-${timestamp()}.md`;
}

export function messageFilename(msg: UIMessage): string {
  return `message-${sanitizeFilename(msg.role)}-${timestamp()}.md`;
}

/** Download markdown content as a `.md` file. */
export function downloadMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/markdown" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
