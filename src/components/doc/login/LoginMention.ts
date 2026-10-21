import { Extension, type Editor, type Range } from "@tiptap/react";
import Suggestion, { exitSuggestion } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { loginHost, savedLoginsAvailable, type SavedLogin } from "@/lib/docs/savedLogins";
import { isInPropertyCell } from "../extensions/docProperties";
import { reactSuggestionRender } from "../ui/suggestionRender";
import { LoginMenu, type LoginMenuPick } from "./LoginMenu";

export const LoginMentionKey = new PluginKey("loginMention");

/** The create dialog (`CreateLoginDialog`) listens for this on the editor DOM. */
export const CREATE_LOGIN_EVENT = "doc-create-login";

export interface CreateLoginRequest {
  /** The "@query" text, left in place until a chip replaces it. */
  range: Range;
  query: string;
}

export function insertLoginChip(editor: Editor, range: Range, login: SavedLogin | { id: string; username: string; host: string }) {
  const host = "host" in login ? login.host : loginHost(login.origin);
  editor
    .chain()
    .focus()
    .insertContentAt(range, [{ type: "docLogin", attrs: { id: login.id, username: login.username, host } }, { type: "text", text: " " }])
    .run();
}

/**
 * "@" at the start of a block or after a space lists the saved logins of the desktop app. Not inside code,
 * not in a property cell, and not at all without the desktop bridge (the "@" stays plain text).
 */
export const LoginMention = Extension.create({
  name: "loginMention",

  addProseMirrorPlugins() {
    return [
      Suggestion<LoginMenuPick, LoginMenuPick>({
        editor: this.editor,
        pluginKey: LoginMentionKey,
        char: "@",
        allowedPrefixes: [" "],
        allow: ({ state, range }) => {
          if (!savedLoginsAvailable()) return false;
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.spec.code) return false;
          const code = state.schema.marks.code;
          if (code && (state.doc.rangeHasMark(range.from, range.to, code) || state.storedMarks?.some((m) => m.type === code) || $from.marks().some((m) => m.type === code))) return false;
          return !isInPropertyCell($from);
        },
        // The menu loads and filters the list itself, to show its loading and error rows.
        items: () => [],
        command: ({ editor, range, props }) => {
          if (props.kind === "login") return insertLoginChip(editor, range, props.login);
          // End the suggestion first so its popover is not drawn over the modal; the typed text stays.
          exitSuggestion(editor.view, LoginMentionKey);
          const detail: CreateLoginRequest = { range, query: props.query };
          editor.view.dom.dispatchEvent(new CustomEvent(CREATE_LOGIN_EVENT, { detail }));
        },
        render: reactSuggestionRender(LoginMenu),
      }),
    ];
  },
});
