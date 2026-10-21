import { useEffect, useSyncExternalStore } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { KeyIcon } from "@phosphor-icons/react";
import { cachedLoginIcon, ensureLoginIconsLoaded, loginChipLabel, subscribeLoginIcons } from "@/lib/docs/savedLogins";

/** The pill for a saved login: the site's favicon (or a key) and `@username · host`. Not editable, one backspace deletes it. */
export function LoginChipView({ node }: NodeViewProps) {
  const { id, username, host } = node.attrs as { id: string; username: string; host: string };
  const icon = useSyncExternalStore(subscribeLoginIcons, () => cachedLoginIcon(id));
  useEffect(() => ensureLoginIconsLoaded(), []);
  return (
    <NodeViewWrapper as="span" className="doc-login" data-type="doc-login" data-id={id} title={loginChipLabel(username, host)}>
      {icon ? <img src={icon} alt="" width={14} height={14} className="doc-login-icon" /> : <KeyIcon size={13} className="doc-login-icon" />}
      <span className="doc-login-text">{loginChipLabel(username, host)}</span>
    </NodeViewWrapper>
  );
}
