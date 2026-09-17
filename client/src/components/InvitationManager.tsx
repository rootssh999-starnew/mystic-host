import { useState } from "react";
import { Copy, MailPlus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

function invitationState(invitation: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }) {
  if (invitation.revokedAt) return "revoked";
  if (invitation.acceptedAt) return "accepted";
  if (new Date(invitation.expiresAt).getTime() <= Date.now()) return "expired";
  return "pending";
}

export default function InvitationManager() {
  const [newToken, setNewToken] = useState<string | null>(null);
  const invitations = trpc.auth.invitations.list.useQuery();
  const create = trpc.auth.invitations.create.useMutation({
    onSuccess: (result) => {
      setNewToken(result.token);
      navigator.clipboard?.writeText(result.token).catch(() => undefined);
      toast.success("Invitation created; token copied when supported");
      invitations.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const revoke = trpc.auth.invitations.revoke.useMutation({
    onSuccess: () => { toast.success("Invitation revoked"); invitations.refetch(); },
    onError: (error) => toast.error(error.message),
  });

  const createInvitation = () => {
    const email = window.prompt("Invite email address");
    if (!email) return;
    const role = (window.prompt("Role: user or admin", "user") || "user").toLowerCase() === "admin" ? "admin" : "user";
    const expiresInHours = Number(window.prompt("Expires in hours", "72") || "72");
    if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 720) {
      toast.error("Expiry must be a whole number from 1 to 720 hours");
      return;
    }
    create.mutate({ email: email.trim(), role, expiresInHours });
  };

  return <section className="admin-card catalog-card">
    <div className="admin-card-heading"><div><span className="admin-card-kicker">Access & identity</span><h2>Invitations</h2></div><button onClick={createInvitation} disabled={create.isPending}><MailPlus size={14} />{create.isPending ? "Creating…" : "Invite user"}</button></div>
    <p className="muted-text">Create short-lived invitation tokens for local account registration. Tokens are shown only after creation.</p>
    {newToken && <div className="invitation-token"><code>{newToken}</code><button onClick={() => { navigator.clipboard?.writeText(newToken).catch(() => undefined); toast.success("Token copied"); }}><Copy size={13} />Copy</button><button onClick={() => setNewToken(null)}>Dismiss</button></div>}
    <div className="invitation-list">{(invitations.data ?? []).slice(0, 20).map((invitation) => { const state = invitationState(invitation); return <div className="invitation-row" key={invitation.id}><span><strong>{invitation.email}</strong><small>{invitation.role} · expires {new Date(invitation.expiresAt).toLocaleString()}</small></span><em className={`invitation-state invitation-state-${state}`}>{state}</em>{state === "pending" && <button title="Revoke invitation" onClick={() => revoke.mutate({ id: invitation.id })} disabled={revoke.isPending}><Trash2 size={13} /></button>}</div>; })}</div>
    {(invitations.data ?? []).length === 0 && <p className="muted-text">No invitations created yet.</p>}
    <small className="invitation-note"><ShieldCheck size={13} />Keep invitation tokens private. The recipient uses the token in the registration form.</small>
  </section>;
}
