import type { FlatSceneNode } from "@/types/scene";
import type { DocumentComponentDefinition } from "@/lib/documentComponents";

export type OpType = "I" | "C" | "U" | "R" | "M" | "D" | "G";

export type ParsedArg =
  | { kind: "string"; value: string }
  | { kind: "binding"; name: string }
  | { kind: "concat"; bindingName: string; pathSuffix: string }
  | { kind: "json"; value: unknown }
  | { kind: "number"; value: number };

export interface ParsedOperation {
  binding?: string;
  op: OpType;
  args: ParsedArg[];
  line: number;
  raw: string;
}

export interface ExecutionContext {
  bindings: Map<string, string>;
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
  createdNodeIds: string[];
  issues: string[];
  /** Document component tag map for expanding c-* tags in embed HTML */
  componentTagMap: Map<string, DocumentComponentDefinition>;
}
