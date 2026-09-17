import { trpc } from "@/lib/trpc";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const DEFAULT_SCOPES = "servers.read,console.read,resources.read,files.read,files.write,backups.read,backups.create,databases.read";

export default function ApiKeyManager() {
  const keys = trpc.auth.apiKeys.list.useQuery();
  const create = trpc.auth.apiKeys.create.useMutation({ onSuccess: (result) => { toast.success("API key created — copy it now; it will not be shown again."); window.prompt("Copy this API token", result.token); keys.refetch(); }, onError: (error) => toast.error(error.message) });
  const revoke = trpc.auth.apiKeys.revoke.useMutation({ onSuccess: () => { toast.success("API key revoked"); keys.refetch(); }, onError: (error) => toast.error(error.message) });
  const createKey = () => { const name = window.prompt("Key name", "Automation key"); if (!name) return; const scopes = (window.prompt("Scopes (comma-separated)", DEFAULT_SCOPES) || "").split(",").map((scope) => scope.trim()).filter(Boolean); if (scopes.length) create.mutate({ name, scopes }); };
  return <section className="admin-card catalog-card"><div className="admin-card-heading"><div><span className="admin-card-kicker">Developer access</span><h2>API keys</h2></div><button onClick={createKey} disabled={create.isPending}><Plus size={14} />Create key</button></div><div className="plan-pills">{(keys.data ?? []).length === 0 ? <span className="muted-text"><KeyRound size={15} />No API keys created</span> : (keys.data ?? []).map((key) => <span key={key.id}><strong>{key.name}</strong><small>{key.scopesJson} · created {new Date(key.createdAt).toLocaleDateString()}</small><button onClick={() => revoke.mutate({ id: key.id })}><Trash2 size={13} /></button></span>)}</div></section>;
}
