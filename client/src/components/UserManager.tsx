import { trpc } from "@/lib/trpc";
import { ShieldCheck, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";

export default function UserManager() {
  const users = trpc.admin.users.useQuery();
  const update = trpc.admin.updateUser.useMutation({ onSuccess: () => { toast.success("User account updated"); users.refetch(); }, onError: (error) => toast.error(error.message) });
  return <section className="admin-card catalog-card"><div className="admin-card-heading"><div><span className="admin-card-kicker">Access & identity</span><h2>User directory</h2></div><ShieldCheck size={18} /></div><div className="plan-pills">{(users.data ?? []).length === 0 ? <span className="muted-text">No users found</span> : (users.data ?? []).map((item) => <span key={item.id}><strong>{item.name || item.email || item.openId}</strong><small>{item.email || "No email"} · {item.role} · {item.disabled ? "disabled" : "active"}</small><button title="Toggle disabled" onClick={() => update.mutate({ userId: item.id, disabled: !item.disabled })}>{item.disabled ? <UserCheck size={13} /> : <UserX size={13} />}</button><button title="Toggle role" onClick={() => update.mutate({ userId: item.id, role: item.role === "admin" ? "user" : "admin" })}><ShieldCheck size={13} /></button></span>)}</div></section>;
}
