import { Contact, ExtLink, IntLink, LegalShell, List, Section } from "@/components/legal/LegalShell";

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy">
      <p>
        This policy explains what personal data Sideform (&ldquo;we&rdquo;) processes when you use the Sideform design
        editor, its AI design agent, and its remote MCP server that lets third-party agents such as ChatGPT, Codex or
        Claude Code work with your canvas. We do not sell your personal data.
      </p>

      <Section title="Accounts are optional">
        <p>
          You can use the editor without an account. If you create one, you can sign in with Google, with an email
          magic link, or with an email and password (provided by Better Auth). Without an account, your browser holds a
          random anonymous identifier that links your agent memory, skills and shared canvases to that browser. If you
          later sign in, that data moves to your account.
        </p>
      </Section>

      <Section title="Data we process">
        <List>
          <li>
            <strong>Account data:</strong> your email address and name, your sign-in method, and session data. For
            email and password sign-in we store a password hash, never the password itself. If you use Google sign-in,
            we receive your name, email and profile image from Google, and we store the OAuth tokens needed to keep your session.
            Each session also stores your IP address and user agent.
          </li>
          <li>
            <strong>Designs you send to the AI agent:</strong> your chat messages, attached images and the canvas
            context the editor sends with each request (for example frames, layers, selection and variables).
          </li>
          <li>
            <strong>Chat traces:</strong> we store the full record of agent requests and responses (raw traces) to find
            and fix product problems. Raw traces are deleted after 14 days. We also keep derived, shorter session
            summaries, insights and agent scenarios used to improve the product. They are linked to your account
            identifier, or to your anonymous identifier if you are not signed in.
          </li>
          <li>
            <strong>Agent memory and user skills:</strong> short notes the agent saves about you and your preferences,
            and custom skills you create. They stay until you delete them or ask us to delete them.
          </li>
          <li>
            <strong>Shared canvases:</strong> if you share a canvas, we store its title and content on our servers and
            anyone with the public link can view it. You can unshare it at any time.
          </li>
          <li>
            <strong>Images:</strong> images you upload and images the agent generates are stored in S3-compatible
            object storage (Cloudflare R2) and are served from a public address.
          </li>
          <li>
            <strong>Connected agents:</strong> OAuth consents and API keys you create for third-party agents. We store
            only a SHA-256 hash of each API key and its first characters, which we show so you can tell keys apart.
          </li>
          <li>
            <strong>Product analytics:</strong> we use PostHog (EU cloud). We capture page views, page-leave events and
            named events such as showcase views, editor opened, chat message sent (with whether it has an attachment
            and a length range, not its text), tool run results, and exports. Automatic event capture and session
            recording are off. We do not send prompt text, document content or file names to analytics. Our backend also records
            usage events in PostHog (turn, model and request metadata such as outcome and error category, with no
            prompt text).
          </li>
          <li>
            <strong>Email delivery:</strong> sign-in and password-reset emails are sent through Resend.
          </li>
        </List>
      </Section>

      <Section title="Local documents">
        <p>
          Documents you create in the editor (.pen files) are stored in your browser or on your device. They are not
          uploaded to our servers, except when you share a canvas, publish to the showcase, or send content to the AI
          agent. Designs you publish to the showcase become public in the gallery; we publish only when you choose to.
        </p>
      </Section>

      <Section title="Third parties that process data">
        <p>Core services:</p>
        <List>
          <li>Render: application hosting.</li>
          <li>Neon: PostgreSQL database.</li>
          <li>Cloudflare R2: image storage.</li>
          <li>Resend: transactional email.</li>
          <li>PostHog: product analytics.</li>
          <li>Google: sign-in, if you choose it.</li>
          <li>
            AI model providers, OpenRouter and DeepSeek: they receive your prompts, attached images and the design
            context needed to answer. OpenRouter also serves our auxiliary vision and image-generation models. Their
            own policies apply to what they do with the data.
          </li>
        </List>
        <p>Services that receive data only when the related feature is used:</p>
        <List>
          <li>
            <strong>Agent web browsing:</strong> Steel runs a cloud browser for the agent. TypeSafe (Jev model)
            receives page snapshots and the task text for browsing steps, and request context for choosing a skill.
          </li>
          <li>
            <strong>Web search:</strong> Tavily receives the search queries and page addresses the agent looks up.
          </li>
          <li>
            <strong>Image tools:</strong> fal.ai receives images for background removal and vectorizing. Quiver
            receives prompts for vector generation.
          </li>
          <li>
            <strong>Design research:</strong> Mobbin, through an OAuth connection you make yourself.
          </li>
          <li>
            <strong>Repositories:</strong> the GitHub API, to read repositories you point the agent at.
          </li>
          <li>
            <strong>Product analysis:</strong> Google Generative Language API receives session summaries to create
            embeddings.
          </li>
          <li>
            <strong>Bring-your-own-key models:</strong> OpenCode. If you supply your own key, your prompts pass
            through our backend to OpenCode.
          </li>
        </List>
      </Section>

      <Section title="Third-party agents">
        <p>
          You can connect agents such as ChatGPT, Codex or Claude Code to Sideform through OAuth or an API key. A
          connected agent can read and change the canvas you have open in the editor. Share access only with agents you
          trust. You can revoke access at any time on the <IntLink path="/account">account page</IntLink>: remove a
          connected agent under &ldquo;Connected agents&rdquo; or revoke an API key under &ldquo;API keys&rdquo;.
        </p>
      </Section>

      <Section title="Retention">
        <List>
          <li>Raw chat traces: 14 days.</li>
          <li>Account data, agent memory and skills: until you delete them or ask us to.</li>
          <li>Shared canvases: until you unshare them or ask us to delete them.</li>
          <li>Uploaded and generated images: until we delete them or you ask us to.</li>
          <li>Session summaries, insights and agent scenarios: until you ask us to delete them.</li>
        </List>
      </Section>

      <Section title="Your choices and deletion requests">
        <p>
          You can ask us to access, correct or delete your personal data, including your account. See the contact
          section below for how to make a request.
        </p>
      </Section>

      <Section title="Children">
        <p>Sideform is not directed at children under 16. Do not use it if you are under 16.</p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          We may update this policy. We will change the date at the top of this page when we do. If a change is
          significant, we will say so on this page.
        </p>
      </Section>

      <Contact />
      <p className="text-text-muted">
        See also our <IntLink path="/terms">Terms of Service</IntLink> and{" "}
        <IntLink path="/support">Support</IntLink> pages. Source code:{" "}
        <ExtLink href="https://github.com/dan-rozhkov/pen-editor">github.com/dan-rozhkov/pen-editor</ExtLink>.
      </p>
    </LegalShell>
  );
}
