import { ORGANIZATION_LIMIT } from "@/lib/auth/orgAccess";

interface AuthErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

// Server error code -> plain text. Unknown codes fall back to the caller's
// sentence so raw server wording never reaches the page.
const BY_CODE: Record<string, string> = {
  YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS:
    `You have reached the limit of ${ORGANIZATION_LIMIT} organizations. Leave or delete one first.`,
  ORGANIZATION_ALREADY_EXISTS: "Could not create the organization. Try again.",
  ORGANIZATION_SLUG_ALREADY_TAKEN: "Could not create the organization. Try again.",
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: "This person is already a member.",
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: "This person already has a pending invitation.",
  INVITATION_LIMIT_REACHED: "This organization has too many pending invitations. Cancel some first.",
  ORGANIZATION_MEMBERSHIP_LIMIT_REACHED: "This organization has reached its member limit.",
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER:
    "You are the only owner. Make another member an owner, or delete the organization.",
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER:
    "You are the only owner. Make another member an owner, or delete the organization.",
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION: "Only owners can invite people.",
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE: "You cannot invite someone with this role.",
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER: "Only owners can change roles.",
  YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER: "Only owners can remove members.",
  YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION: "Only owners can delete an organization.",
  YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION: "Only owners can cancel invitations.",
  INVITATION_NOT_FOUND: "This invitation has expired or was cancelled. Ask for a new one.",
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION:
    "This invitation was sent to a different email address. Sign in with the address it was sent to.",
  EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION:
    "Verify your email address before you accept this invitation.",
  INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION:
    "The person who invited you has left the organization. Ask for a new invitation.",
};

/** Plain-text message for a Better Auth organization error. */
export function orgErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as AuthErrorLike;
  if (e.code && BY_CODE[e.code]) return BY_CODE[e.code];
  // The backend's own 409 on delete (not a plugin code).
  if (e.status === 409 && /librar/i.test(e.message ?? "")) {
    return "This organization still has design-system libraries. Purge or move them first, then delete it.";
  }
  if (e.status === 403) return "You do not have permission to do this.";
  return fallback;
}
