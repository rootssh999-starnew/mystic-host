import { trpc } from "@/lib/trpc";
import { Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

export default function TeamManager() {
  const teams = trpc.admin.teams.useQuery();
  const create = trpc.admin.createTeam.useMutation({ onSuccess: () => { toast.success("Team created"); teams.refetch(); }, onError: (error) => toast.error(error.message) });
  const add = trpc.admin.addTeamMember.useMutation({ onSuccess: () => toast.success("Team member added"), onError: (error) => toast.error(error.message) });
  const createTeam = () => { const name = window.prompt("Team name", "Operations"); if (!name) return; create.mutate({ name, description: window.prompt("Description", "Hosting operations team") || "" }); };
  const addMember = (teamId: number) => { const userId = Number(window.prompt("User ID", "1")); if (!userId) return; const role = (window.prompt("Role: manager or member", "member") || "member") as "manager" | "member"; add.mutate({ teamId, userId, role: role === "manager" ? "manager" : "member" }); };
  return <section className="admin-card catalog-card"><div className="admin-card-heading"><div><span className="admin-card-kicker">Workspace access</span><h2>Teams</h2></div><button onClick={createTeam}><Plus size={14} />Create team</button></div><div className="plan-pills">{(teams.data ?? []).length === 0 ? <span className="muted-text"><Users size={15} />No teams created</span> : (teams.data ?? []).map((team) => <span key={team.id}><strong>{team.name}</strong><small>{team.description}</small><button onClick={() => addMember(team.id)}><Plus size={13} />Member</button></span>)}</div></section>;
}
