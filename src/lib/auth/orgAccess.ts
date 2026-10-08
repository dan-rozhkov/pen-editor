import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, memberAc, ownerAc } from "better-auth/plugins/organization/access";

// Mirror of the backend's src/auth/organization.ts (statements + the three
// roles). Re-declared, not imported: the frontend never reaches into the
// backend repo. Keep both in step; the client only needs them to type roles
// and run local permission checks.
export const statements = {
  ...defaultStatements,
  library: ["read", "comment", "write", "publish", "approve", "admin"],
} as const;

export const ac = createAccessControl(statements);

export const ORG_ROLES = {
  owner: ac.newRole({
    ...ownerAc.statements,
    library: ["read", "comment", "write", "publish", "approve", "admin"],
  }),
  editor: ac.newRole({
    ...memberAc.statements,
    library: ["read", "comment", "write", "publish", "approve"],
  }),
  viewer: ac.newRole({
    ...memberAc.statements,
    library: ["read", "comment"],
  }),
};

export type OrgRole = keyof typeof ORG_ROLES;
export const ORG_ROLE_NAMES: OrgRole[] = ["owner", "editor", "viewer"];
export const ORGANIZATION_LIMIT = 5;

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

export function asOrgRole(role: string): OrgRole {
  return (ORG_ROLE_NAMES as string[]).includes(role) ? (role as OrgRole) : "viewer";
}
