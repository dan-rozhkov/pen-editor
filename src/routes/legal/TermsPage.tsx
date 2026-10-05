import { Contact, IntLink, LegalShell, List, Section } from "@/components/legal/LegalShell";

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service">
      <p>
        These terms govern your use of Sideform (&ldquo;we&rdquo;): the design editor, the AI design agent, and the
        remote MCP server for third-party agents. By using Sideform you agree to them. How we handle personal data is
        described in the <IntLink path="/privacy">Privacy Policy</IntLink>.
      </p>

      <Section title="Using Sideform">
        <p>You may use Sideform without an account. Some features, such as connecting third-party agents, need one. Keep your sign-in details and API keys secret. You are responsible for activity under your account and your keys.</p>
      </Section>

      <Section title="Acceptable use">
        <p>You agree not to:</p>
        <List>
          <li>break the law or infringe the rights of others;</li>
          <li>create or share content that is illegal, abusive, or that sexually exploits children;</li>
          <li>attempt to disrupt, overload, probe or gain unauthorized access to the service or other users&rsquo; data;</li>
          <li>bypass rate limits or other technical limits, or use automated means to abuse the service;</li>
          <li>use the AI agent to produce malware, or content designed to deceive or defraud people.</li>
        </List>
      </Section>

      <Section title="Your content">
        <p>
          You own your designs and the other content you create or upload. You give us a limited licence to host,
          process and transmit that content, including sending it to AI model providers, only as needed to provide and
          improve the service. If you share a canvas by public link, anyone with the link can view it. You are
          responsible for having the right to use the content you submit.
        </p>
      </Section>

      <Section title="AI output">
        <p>
          AI-generated designs and text can be wrong, incomplete or similar to other output. Review everything before
          you rely on it. We do not guarantee that AI output is accurate, original or fit for a purpose, and you are
          responsible for how you use it.
        </p>
      </Section>

      <Section title="Third-party agents">
        <p>
          You may connect third-party agents (for example ChatGPT, Codex or Claude Code) through OAuth or an API key. A
          connected agent can read and change your open canvas. You are responsible for the agents you connect and for
          what they do. We do not control third-party agents. Revoke access on the{" "}
          <IntLink path="/account">account page</IntLink> if you stop trusting an agent.
        </p>
      </Section>

      <Section title="No warranty">
        <p>Sideform is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose and non-infringement. We do not promise that the service will be uninterrupted or error-free. Keep your own backups of documents you care about.</p>
      </Section>

      <Section title="Limitation of liability">
        <p>
          To the maximum extent the law allows, we are not liable for indirect, incidental, special or consequential
          damages, or for loss of data, profits or goodwill, arising from your use of Sideform. Where liability cannot be
          excluded, it is limited to the amount you paid us for the service in the 12 months before the claim, which for
          a free service is zero.
        </p>
      </Section>

      <Section title="Termination">
        <p>
          You can stop using Sideform at any time and ask us to delete your account. We may suspend or end access if
          you break these terms or if we must do so to protect the service or other people. We may also change or
          discontinue the service.
        </p>
      </Section>

      <Section title="Changes to these terms">
        <p>
          We may update these terms. We will change the date at the top of this page when we do. If you keep using
          Sideform after a change, you accept the new terms.
        </p>
      </Section>

      <Contact />
    </LegalShell>
  );
}
