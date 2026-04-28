import { clerkClient } from "@clerk/nextjs/server";

import { isClerkEnabled } from "@/lib/security/clerk";

export async function revokePendingClerkInvitationsByEmail(email: string): Promise<string[]> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !isClerkEnabled()) {
    return [];
  }

  const clerk = await clerkClient();
  const invitations = await clerk.invitations.getInvitationList({
    query: normalizedEmail,
    limit: 100,
  });

  const matchingPending = invitations.data.filter((invitation) => {
    return (
      invitation.emailAddress.trim().toLowerCase() === normalizedEmail &&
      invitation.status === "pending" &&
      invitation.revoked !== true
    );
  });

  const revokedInvitationIds: string[] = [];
  for (const invitation of matchingPending) {
    await clerk.invitations.revokeInvitation(invitation.id);
    revokedInvitationIds.push(invitation.id);
  }

  return revokedInvitationIds;
}
