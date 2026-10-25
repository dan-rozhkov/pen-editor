import { ApiKeysSection } from "@/components/auth/ApiKeysSection";
import { ConnectedAgentsSection } from "@/components/auth/ConnectedAgentsSection";
import { SignInControl } from "@/components/auth/SignInControl";
import { formatProviders, useLinkedProviders } from "@/components/auth/useLinkedProviders";
import { Button } from "@/components/ui/button";
import { signOut, useSession } from "@/lib/auth/session";

import { SettingsGroup } from "../SettingsSection";

export default function AccountSectionInner() {
  const { data, isPending } = useSession();
  const user = data?.user;
  const providers = useLinkedProviders(Boolean(user));

  if (isPending) {
    return (
      <p role="status" className="py-5 text-sm text-text-muted">
        Loading…
      </p>
    );
  }
  if (!user) {
    return (
      <SettingsGroup inline title="Not signed in" description="Sign in to sync your skills and use API keys.">
        <SignInControl
          className="inline-flex h-7 items-center rounded-md bg-accent-primary px-3 text-xs font-medium text-white outline-none hover:bg-accent-primary/90 focus-visible:ring-[2px] focus-visible:ring-ring"
        />
      </SettingsGroup>
    );
  }

  const label = user.name || user.email;
  return (
    <>
      <SettingsGroup inline title="Profile" description={`${user.email} · Sign-in methods: ${formatProviders(providers)}`}>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-primary/10 text-xs font-semibold text-accent-primary"
          >
            {user.image ? <img src={user.image} alt="" className="size-full object-cover" /> : label.slice(0, 1).toUpperCase()}
          </span>
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </SettingsGroup>
      <div className="border-b border-border-default py-5">
        <ApiKeysSection />
      </div>
      <div className="py-5">
        <ConnectedAgentsSection />
      </div>
    </>
  );
}
