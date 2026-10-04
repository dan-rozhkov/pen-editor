const SCOPE_TEXT: Record<string, string> = {
  openid: "Know who you are",
  profile: "See your name and avatar",
  email: "See your email address",
  offline_access: "Stay connected without asking you again",
  "mcp:tools": "Use Sideform design tools in your open editor",
};

export function describeScope(scope: string): string {
  return SCOPE_TEXT[scope] ?? scope;
}
