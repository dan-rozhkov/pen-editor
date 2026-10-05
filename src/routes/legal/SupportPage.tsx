import { Contact, IntLink, LegalShell, List, Section } from "@/components/legal/LegalShell";

const MCP_URL = "https://api.sideform.pro/mcp";

export default function SupportPage() {
  return (
    <LegalShell title="Support">
      <p>Help with Sideform and with connecting an AI agent to your canvas.</p>

      <Section title="Connect an agent">
        <p>
          Sideform has a remote MCP server. Add this URL to ChatGPT, Codex, Claude Code or any other MCP client:
        </p>
        <p>
          <code className="rounded bg-surface-elevated px-1.5 py-0.5 font-mono text-xs">{MCP_URL}</code>
        </p>
        <List>
          <li>
            <strong>OAuth:</strong> add the URL as a remote MCP server. Your client opens a Sideform page where you
            sign in and approve access.
          </li>
          <li>
            <strong>API key:</strong> for clients that cannot use OAuth, create a key on the{" "}
            <IntLink path="/account">account page</IntLink> under &ldquo;API keys&rdquo; and send it as a bearer
            token. Keys start with <code className="font-mono text-xs">sf_</code>. Copy the key when you create it; it
            is shown once.
          </li>
          <li>
            <strong>See the canvas:</strong> ask the agent to run the <code className="font-mono text-xs">open_canvas</code>{" "}
            tool. In hosts that support MCP Apps it shows the canvas inline. Otherwise keep the Sideform editor open
            in a browser tab where you are signed in.
          </li>
        </List>
      </Section>

      <Section title="Common errors">
        <List>
          <li>
            <strong>&ldquo;No Sideform editor is open for your account.&rdquo;</strong> The agent has no canvas to
            work on. Open the editor at <IntLink path="/app">/app</IntLink> while signed in to the same account, then
            retry. Or call <code className="font-mono text-xs">open_canvas</code> first.
          </li>
          <li>
            <strong>Authorization or 401 errors:</strong> sign in again, approve the connection again, or check that
            the API key was not revoked.
          </li>
        </List>
      </Section>

      <Section title="Revoke access">
        <p>
          Open the <IntLink path="/account">account page</IntLink>. Under &ldquo;Connected agents&rdquo; select
          &ldquo;Revoke access&rdquo; next to the agent. Under &ldquo;API keys&rdquo; select &ldquo;Revoke&rdquo; next
          to the key. API keys stop working immediately. An agent connected through OAuth may keep access for up to 15 minutes, until its current access token expires.
        </p>
      </Section>

      <Contact />
    </LegalShell>
  );
}
