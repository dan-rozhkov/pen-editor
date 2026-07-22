// ask_user is resolved by the in-chat AskUserForm (see MessageList), which
// calls chat.addToolOutput directly. useDesignChat.onToolCall skips ask_user,
// so this handler is only a contract-required fallback and should not run in
// normal flow.
export async function askUser(): Promise<string> {
  return JSON.stringify({
    error: "ask_user is answered via the in-chat form, not this handler",
  });
}
