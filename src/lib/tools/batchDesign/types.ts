import type { FlatSceneNode } from "@/types/scene";

export type OpType = "I" | "C" | "U" | "R" | "M" | "D" | "G";

export type ParsedArg =
  | { kind: "string"; value: string }
  | { kind: "binding"; name: string }
  | { kind: "concat"; bindingName: string; pathSuffix: string }
  | { kind: "json"; value: Record<string, unknown> }
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
}
