import type { OpType, ParsedArg, ParsedOperation } from "./types";
import JSON5 from "json5";

const OP_TYPES = new Set<string>(["I", "C", "U", "R", "M", "D", "G"]);
const MAX_OPERATIONS = 25;

/**
 * Parse a batch_design operations script into structured operations.
 * Each line is: [binding=]OP(arg1, arg2, ...)
 */
export function parseOperations(input: string): ParsedOperation[] {
  const lines = input.split("\n");
  const operations: ParsedOperation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith("//") || raw.startsWith("#")) continue;

    const parsed = parseLine(raw, i + 1);
    operations.push(parsed);
  }

  if (operations.length === 0) {
    throw new Error("No operations to execute");
  }
  if (operations.length > MAX_OPERATIONS) {
    throw new Error(
      `Too many operations (${operations.length}). Maximum is ${MAX_OPERATIONS}.`
    );
  }

  return operations;
}

function parseLine(raw: string, lineNum: number): ParsedOperation {
  let remaining = raw;
  let binding: string | undefined;

  // Check for binding assignment: identifier=OP(...)
  const bindingMatch = remaining.match(/^(\w+)=([A-Z])\(/);
  if (bindingMatch) {
    binding = bindingMatch[1];
    remaining = remaining.slice(bindingMatch[1].length + 1); // skip "binding="
  }

  // Match operation: OP(...)
  const opMatch = remaining.match(/^([A-Z])\(/);
  if (!opMatch || !OP_TYPES.has(opMatch[1])) {
    throw new Error(
      `Line ${lineNum}: Invalid operation syntax: "${raw}"`
    );
  }

  const op = opMatch[1] as OpType;
  remaining = remaining.slice(2); // skip "OP("

  // Find matching closing paren using brace-aware scanning
  const argsStr = extractBalancedArgs(remaining, lineNum);

  // Tokenize arguments
  const args = tokenizeArgs(argsStr, lineNum);

  return { binding, op, args, line: lineNum, raw };
}

/**
 * Extract the arguments string between outer parentheses,
 * handling nested braces, brackets, and strings.
 */
function extractBalancedArgs(str: string, lineNum: number): string {
  let depth = 1; // we already consumed the opening paren
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0 && braceDepth === 0 && bracketDepth === 0) {
        return str.slice(0, i);
      }
    }
  }

  throw new Error(`Line ${lineNum}: Unbalanced parentheses`);
}

/**
 * Split arguments by commas at depth 0, respecting nested structures.
 */
function tokenizeArgs(argsStr: string, lineNum: number): ParsedArg[] {
  if (!argsStr.trim()) return [];

  const tokens: string[] = [];
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escaped = false;
  let current = "";

  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];

    if (escaped) {
      escaped = false;
      current += ch;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      current += ch;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      current += ch;
      continue;
    }

    if (inString) {
      current += ch;
      continue;
    }

    if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;

    if (ch === "," && braceDepth === 0 && bracketDepth === 0) {
      tokens.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    tokens.push(current.trim());
  }

  return tokens.map((token) => classifyToken(token, lineNum));
}

/**
 * Classify a token into one of the ParsedArg kinds.
 */
function classifyToken(token: string, lineNum: number): ParsedArg {
  if (token === "undefined") {
    return { kind: "json", value: undefined };
  }

  // String literal: "..."
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    try {
      const decoded = JSON5.parse(token);
      if (typeof decoded === "string") {
        return { kind: "string", value: decodeHtmlEntities(decoded) };
      }
    } catch {
      throw new Error(`Line ${lineNum}: Invalid string literal: ${token}`);
    }
  }

  // JSON object or array: {...} or [...]
  if (
    (token.startsWith("{") && token.endsWith("}")) ||
    (token.startsWith("[") && token.endsWith("]"))
  ) {
    try {
      return { kind: "json", value: parseJsonLike(token) };
    } catch {
      throw new Error(
        `Line ${lineNum}: Invalid JSON: ${token.slice(0, 60)}...`
      );
    }
  }

  // Concatenation: identifier+"/path/..."
  if (token.includes("+")) {
    const plusIdx = token.indexOf("+");
    const bindingName = token.slice(0, plusIdx).trim();
    let pathPart = token.slice(plusIdx + 1).trim();
    // Remove quotes from the path part
    if (pathPart.startsWith('"') && pathPart.endsWith('"')) {
      pathPart = pathPart.slice(1, -1);
    }
    return { kind: "concat", bindingName, pathSuffix: pathPart };
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(token)) {
    return { kind: "number", value: Number(token) };
  }

  // Boolean true/false — treat as JSON
  if (token === "true" || token === "false" || token === "null") {
    return { kind: "json", value: JSON5.parse(token) };
  }

  // Bare identifier → binding reference
  if (/^\w+$/.test(token)) {
    return { kind: "binding", name: token };
  }

  throw new Error(
    `Line ${lineNum}: Cannot classify argument: "${token}"`
  );
}

function parseJsonLike(token: string): unknown {
  try {
    return JSON.parse(token);
  } catch {
    return JSON5.parse(token);
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
