import { useCallback, useEffect, useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth/authClient";
import {
  asOrgRole,
  ORG_ROLE_NAMES,
  ORGANIZATION_LIMIT,
  ROLE_LABELS,
  type OrgRole,
} from "@/lib/auth/orgAccess";
import { orgErrorMessage } from "@/lib/auth/orgErrors";
import { slugify } from "@/lib/variables/shared";

import { AuthButton, FormMessage, LinkButton, TextField } from "./authUi";

interface OrgRow {
  id: string;
  name: string;
}
interface MemberRow {
  id: string;
  userId: string;
  role: string;
  user?: { email?: string; name?: string };
}
interface InvitationRow {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt?: string | Date;
}
interface Detail {
  members: MemberRow[];
  invitations: InvitationRow[];
}

const SELECT =
  "h-10 rounded-md border border-border-default bg-surface-panel px-2 text-base text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary";

function orgSlug(name: string): string {
  // Slugs are globally unique; a suffix keeps two "Design team"s apart.
  return `${slugify(name, "org").slice(0, 40)}-${Math.random().toString(36).slice(2, 7)}`;
}

const isExpired = (inv: InvitationRow): boolean =>
  inv.expiresAt !== undefined && new Date(inv.expiresAt).getTime() < Date.now();

function RoleSelect({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (role: OrgRole) => void;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label={label}
      className={SELECT}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as OrgRole)}
    >
      {ORG_ROLE_NAMES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </select>
  );
}

function OrganizationDetail({
  org,
  userId,
  onGone,
  onMessage,
}: {
  org: OrgRow;
  userId: string;
  onGone: () => void;
  onMessage: (m: { error?: string; notice?: string }) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<{ memberId: string; role: OrgRole } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("viewer");
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    const fail = () => {
      if (!live) return;
      // Keep the previous list on screen; offer a retry instead.
      setLoadFailed(true);
      setDetail((d) => d ?? { members: [], invitations: [] });
    };
    void authClient.organization
      .getFullOrganization({ query: { organizationId: org.id } })
      .then((res) => {
        if (!live) return;
        if (res.error || !res.data) return fail();
        const data = res.data as unknown as Partial<Detail>;
        setLoadFailed(false);
        setDetail({
          members: data.members ?? [],
          invitations: (data.invitations ?? []).filter((i) => i.status === "pending"),
        });
      })
      .catch(fail);
    return () => {
      live = false;
    };
  }, [org.id, tick]);

  const me = detail?.members.find((m) => m.userId === userId);
  const isOwner = me?.role === "owner";

  async function run(
    action: () => Promise<{ error?: unknown }>,
    fallback: string,
    success: string,
    after: () => void = reload,
    rollback?: () => void,
  ) {
    setBusy(true);
    setConfirm(null);
    onMessage({});
    try {
      const res = await action();
      if (res.error) {
        rollback?.();
        onMessage({ error: orgErrorMessage(res.error, fallback) });
      } else {
        onMessage({ notice: success });
        after();
      }
    } catch {
      rollback?.();
      onMessage({ error: fallback });
    } finally {
      setBusy(false);
    }
  }

  function cancelConfirm() {
    setConfirm(null);
    setPendingRole(null);
  }

  function changeRole(m: MemberRow, role: OrgRole, who: string) {
    const previous = m.role;
    const apply = (r: string) =>
      setDetail((d) => d && { ...d, members: d.members.map((x) => (x.id === m.id ? { ...x, role: r } : x)) });
    apply(role);
    setPendingRole(null);
    void run(
      () => authClient.organization.updateMemberRole({ memberId: m.id, role, organizationId: org.id }),
      "Could not change the role.",
      `Role for ${who} is now ${ROLE_LABELS[role].toLowerCase()}.`,
      reload,
      () => apply(previous),
    );
  }

  function invite(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    void run(
      () => authClient.organization.inviteMember({ email: address, role: inviteRole, organizationId: org.id }),
      "Could not send the invitation.",
      `Invitation sent to ${address}.`,
      () => {
        setEmail("");
        reload();
      },
    );
  }

  const heading = `org-${org.id}-heading`;
  return (
    <section aria-labelledby={heading} className="flex flex-col gap-3 rounded-md border border-border-default p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id={heading} className="truncate text-sm font-semibold text-text-primary">
          {org.name}
        </h3>
        {me && <span className="text-xs text-text-muted">Your role: {ROLE_LABELS[asOrgRole(me.role)]}</span>}
      </div>

      {loadFailed && (
        <div className="flex items-center gap-2">
          <FormMessage kind="error">Could not load the members.</FormMessage>
          <LinkButton onClick={reload}>Retry</LinkButton>
        </div>
      )}
      {detail === null ? (
        <p role="status" className="text-sm text-text-muted">
          Loading…
        </p>
      ) : (
        <>
          <ul aria-label={`Members of ${org.name}`} className="divide-y divide-border-default text-sm">
            {detail.members.map((m) => {
              const who = m.user?.email ?? m.user?.name ?? m.userId;
              const self = m.userId === userId;
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0 truncate text-text-primary">
                    {who}
                    {self ? " (you)" : ""}
                  </span>
                  <span className="flex items-center gap-2">
                    {isOwner && !self ? (
                      <>
                        <RoleSelect
                          label={`Role for ${who}`}
                          value={pendingRole?.memberId === m.id ? pendingRole.role : asOrgRole(m.role)}
                          disabled={busy}
                          onChange={(role) => {
                            setConfirm(`role-${m.id}`);
                            setPendingRole({ memberId: m.id, role });
                          }}
                        />
                        {confirm === `role-${m.id}` && pendingRole?.memberId === m.id && (
                          <>
                            <AuthButton
                              disabled={busy}
                              aria-label={`Confirm role ${ROLE_LABELS[pendingRole.role].toLowerCase()} for ${who}`}
                              onClick={() => changeRole(m, pendingRole.role, who)}
                            >
                              Confirm role
                            </AuthButton>
                            <LinkButton onClick={cancelConfirm}>Cancel</LinkButton>
                          </>
                        )}
                        {confirm !== `role-${m.id}` && (confirm === `rm-${m.id}` ? (
                          <AuthButton
                            variant="danger"
                            disabled={busy}
                            aria-label={`Confirm remove ${who}`}
                            onClick={() =>
                              void run(
                                () => authClient.organization.removeMember({ memberIdOrEmail: m.id, organizationId: org.id }),
                                "Could not remove the member.",
                                `${who} was removed.`,
                              )
                            }
                          >
                            Confirm remove
                          </AuthButton>
                        ) : (
                          <AuthButton
                            variant="secondary"
                            disabled={busy}
                            aria-label={`Remove ${who}`}
                            onClick={() => setConfirm(`rm-${m.id}`)}
                          >
                            Remove
                          </AuthButton>
                        ))}
                      </>
                    ) : (
                      <span className="text-text-muted">{ROLE_LABELS[asOrgRole(m.role)]}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          {isOwner && detail.invitations.length > 0 && (
            <ul aria-label={`Pending invitations for ${org.name}`} className="divide-y divide-border-default text-sm">
              {detail.invitations.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0 truncate text-text-muted">
                    {inv.email} · {ROLE_LABELS[asOrgRole(inv.role)]} · {isExpired(inv) ? "Expired" : "Invited"}
                  </span>
                  {isExpired(inv) && (
                    <AuthButton
                      variant="secondary"
                      disabled={busy}
                      aria-label={`Resend invitation to ${inv.email}`}
                      onClick={() =>
                        void run(
                          () =>
                            authClient.organization.inviteMember({
                              email: inv.email,
                              role: asOrgRole(inv.role),
                              organizationId: org.id,
                            }),
                          "Could not resend the invitation.",
                          `Invitation sent to ${inv.email}.`,
                        )
                      }
                    >
                      Resend invitation
                    </AuthButton>
                  )}
                  <AuthButton
                    variant="secondary"
                    disabled={busy}
                    aria-label={`Cancel invitation for ${inv.email}`}
                    onClick={() =>
                      void run(
                        () => authClient.organization.cancelInvitation({ invitationId: inv.id }),
                        "Could not cancel the invitation.",
                        "Invitation cancelled.",
                      )
                    }
                  >
                    Cancel invitation
                  </AuthButton>
                </li>
              ))}
            </ul>
          )}

          {isOwner && (
            <form onSubmit={invite} className="flex flex-wrap items-end gap-2" aria-label={`Invite to ${org.name}`}>
              <div className="min-w-48 flex-1">
                <TextField
                  label="Invite by email"
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <RoleSelect label="Role for the invitation" value={inviteRole} onChange={setInviteRole} />
              <AuthButton type="submit" disabled={busy || !email.trim()}>
                Send invitation
              </AuthButton>
            </form>
          )}

          <div className="flex flex-wrap gap-2">
            {confirm === "leave" ? (
              <AuthButton
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => authClient.organization.leave({ organizationId: org.id }),
                    "Could not leave the organization.",
                    `You left ${org.name}.`,
                    onGone,
                  )
                }
              >
                Confirm leave
              </AuthButton>
            ) : (
              <AuthButton variant="secondary" disabled={busy} onClick={() => setConfirm("leave")}>
                Leave organization
              </AuthButton>
            )}
            {isOwner &&
              (confirm === "delete" ? (
                <AuthButton
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => authClient.organization.delete({ organizationId: org.id }),
                      "Could not delete the organization.",
                      `${org.name} was deleted.`,
                      onGone,
                    )
                  }
                >
                  Confirm delete
                </AuthButton>
              ) : (
                <AuthButton variant="danger" disabled={busy} onClick={() => setConfirm("delete")}>
                  Delete organization
                </AuthButton>
              ))}
            {confirm && !confirm.startsWith("role-") && <LinkButton onClick={cancelConfirm}>Cancel</LinkButton>}
          </div>
        </>
      )}
    </section>
  );
}

// Organizations the account belongs to: the owner of an organization manages
// members and invitations here; editors and viewers can only leave.
export function OrganizationsSection({ userId }: { userId: string }) {
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [tick, setTick] = useState(0);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; notice?: string }>({});
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    void authClient.organization
      .list()
      .then((res) => {
        if (!live) return;
        if (res.error) setMsg({ error: "Could not load your organizations." });
        setOrgs(res.error ? [] : ((res.data ?? []) as OrgRow[]));
      })
      .catch(() => {
        if (!live) return;
        setMsg({ error: "Could not load your organizations." });
        setOrgs([]);
      });
    return () => {
      live = false;
    };
  }, [tick]);

  async function create(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setMsg({});
    try {
      const attempt = () => authClient.organization.create({ name: trimmed, slug: orgSlug(trimmed) });
      let res = await attempt();
      const code = (res.error as { code?: string } | null)?.code;
      // Slugs are random-suffixed; a collision is one-in-millions. Retry once.
      if (code === "ORGANIZATION_SLUG_ALREADY_TAKEN") res = await attempt();
      if (res.error) setMsg({ error: orgErrorMessage(res.error, "Could not create the organization.") });
      else {
        setName("");
        setMsg({ notice: `${trimmed} was created.` });
        reload();
      }
    } catch {
      setMsg({ error: "Could not create the organization." });
    } finally {
      setCreating(false);
    }
  }

  const full = orgs !== null && orgs.length >= ORGANIZATION_LIMIT;

  return (
    <section aria-labelledby="orgs-heading" className="flex flex-col gap-3">
      <h2 id="orgs-heading" className="text-base font-semibold text-text-primary">
        Organizations
      </h2>
      {msg.error && <FormMessage kind="error">{msg.error}</FormMessage>}
      {msg.notice && <FormMessage kind="notice">{msg.notice}</FormMessage>}
      {orgs === null ? (
        <p role="status" className="text-sm text-text-muted">
          Loading…
        </p>
      ) : orgs.length === 0 ? (
        <p className="text-sm text-text-muted">You do not belong to any organization.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {orgs.map((org) => (
            <OrganizationDetail key={org.id} org={org} userId={userId} onGone={reload} onMessage={setMsg} />
          ))}
        </div>
      )}
      <form onSubmit={(e) => void create(e)} className="flex flex-wrap items-end gap-2" aria-label="Create an organization">
        <div className="min-w-48 flex-1">
          <TextField
            label="Organization name"
            value={name}
            maxLength={80}
            hint={full ? `You have reached the limit of ${ORGANIZATION_LIMIT} organizations.` : undefined}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <AuthButton type="submit" disabled={creating || full || !name.trim()}>
          Create organization
        </AuthButton>
      </form>
    </section>
  );
}
