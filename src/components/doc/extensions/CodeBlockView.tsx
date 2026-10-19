import { useEffect, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { errorMessage, renderMermaid } from "./mermaidRender";

const DEBOUNCE_MS = 150;

export function CodeBlockView(props: NodeViewProps) {
  const language = (props.node.attrs.language as string | null) ?? "";
  if (language === "mermaid") return <MermaidBlock {...props} />;
  return (
    <NodeViewWrapper as="pre">
      <NodeViewContent<"code"> as="code" className={language ? `language-${language}` : undefined} />
    </NodeViewWrapper>
  );
}

/** True while the selection touches this node: a node selection, or the focused cursor inside its source. */
function useIsEditing({ editor, getPos, node, selected }: NodeViewProps): boolean {
  const [inside, setInside] = useState(false);
  useEffect(() => {
    const update = () => {
      const pos = getPos();
      const { from, to } = editor.state.selection;
      setInside(editor.isFocused && pos !== undefined && from > pos && to < pos + node.nodeSize);
    };
    update();
    editor.on("selectionUpdate", update);
    editor.on("focus", update);
    editor.on("blur", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("focus", update);
      editor.off("blur", update);
    };
  }, [editor, getPos, node.nodeSize]);
  return selected || inside;
}

function MermaidBlock(props: NodeViewProps) {
  const { editor, getPos, node } = props;
  const editing = useIsEditing(props);
  const source = node.textContent;
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  // An outdated SVG is never shown after a failed render; no valid SVG means the source stays visible and editable.
  const validSvg = error ? "" : svg;
  const empty = source.trim() === "";
  // pending (no result yet) | ok | error | empty: only editing, an error or an empty source reveal the source.
  const pending = !empty && !settled && !validSvg && !error;
  const showSource = editing || empty || Boolean(error) || (!validSvg && !pending);
  const previewRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!source.trim()) {
        setSvg("");
        setError(null);
        setSettled(true);
        return;
      }
      renderMermaid(source).then(
        (out) => {
          if (cancelled) return;
          setSvg(out);
          setError(null);
          setSettled(true);
        },
        (err: unknown) => {
          if (cancelled) return;
          setError(errorMessage(err));
          setSettled(true);
        },
      );
    };
    const delay = firstRender.current ? 0 : DEBOUNCE_MS;
    firstRender.current = false;
    const timer = setTimeout(run, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source]);

  // Pele escapes diagram text and filters links/styles; its output still goes through a detached container.
  useEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    const template = document.createElement("template");
    template.innerHTML = validSvg;
    host.replaceChildren(template.content);
  }, [validSvg]);

  const focusSource = () => {
    const pos = getPos();
    if (pos !== undefined) editor.chain().focus().setTextSelection(pos + 1).run();
  };

  return (
    <NodeViewWrapper className="doc-mermaid" data-editing={editing ? "true" : "false"}>
      <pre className="doc-mermaid-source" hidden={!showSource}>
        <NodeViewContent<"code"> as="code" className="language-mermaid" />
      </pre>
      <div className="doc-mermaid-body" contentEditable={false} data-pending={pending ? "true" : "false"}>
        {error && editing ? (
          <p className="doc-mermaid-error" role="alert">
            {error}
          </p>
        ) : null}
        <div
          ref={previewRef}
          className="doc-mermaid-preview"
          data-empty={validSvg ? "false" : "true"}
          onClick={editing ? undefined : focusSource}
        />
        {!validSvg && !editing && (error || empty) ? (
          <p
            className="doc-mermaid-hint"
            role="button"
            tabIndex={0}
            onClick={focusSource}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                focusSource();
              }
            }}
          >
            {error ?? (empty ? "Empty diagram" : "")}
          </p>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}
