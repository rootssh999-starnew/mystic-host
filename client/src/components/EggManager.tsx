import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Download, Pencil, Plus, Trash2, Upload } from "lucide-react";

export default function EggManager() {
  const nests = trpc.admin.nests.useQuery();
  const eggs = trpc.admin.eggs.useQuery();
  const createNest = trpc.admin.createNest.useMutation({ onSuccess: () => { toast.success("Nest created"); nests.refetch(); }, onError: (error) => toast.error(error.message) });
  const createEgg = trpc.admin.createEgg.useMutation({ onSuccess: () => { toast.success("Egg created"); eggs.refetch(); }, onError: (error) => toast.error(error.message) });
  const updateEgg = trpc.admin.updateEgg.useMutation({ onSuccess: () => { toast.success("Egg updated"); eggs.refetch(); }, onError: (error) => toast.error(error.message) });
  const deleteEgg = trpc.admin.deleteEgg.useMutation({ onSuccess: () => { toast.success("Egg deleted"); eggs.refetch(); }, onError: (error) => toast.error(error.message) });
  const exportEgg = trpc.admin.exportEgg.useMutation();

  const newNest = () => {
    const name = window.prompt("Nest name", "Minecraft");
    if (!name) return;
    createNest.mutate({ name, description: window.prompt("Nest description", "Dedicated game server templates") || "" });
  };
  const newEgg = () => {
    const nestId = Number(window.prompt("Nest ID", String(nests.data?.[0]?.id || "")));
    const name = window.prompt("Egg name", "Vanilla Minecraft");
    if (!nestId || !name) return;
    const slug = (window.prompt("Egg slug", name.toLowerCase().replace(/[^a-z0-9]+/g, "-")) || "").trim();
    const image = window.prompt("Docker image", "itzg/minecraft-server:java21") || "node:22-bookworm";
    const startup = window.prompt("Startup command", "java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M -jar server.jar nogui") || "";
    createEgg.mutate({ nestId, name, slug, image, startup, installScript: window.prompt("Install script", "") || "", environmentJson: window.prompt("Environment JSON", "{}") || "{}" });
  };
  const editEgg = (egg: NonNullable<typeof eggs.data>[number]) => {
    const startup = window.prompt("Startup command", egg.startup);
    if (startup === null) return;
    updateEgg.mutate({ id: egg.id, startup, image: window.prompt("Docker image", egg.image) || egg.image, installScript: window.prompt("Install script", egg.installScript) ?? egg.installScript, environmentJson: window.prompt("Environment JSON", egg.environmentJson) || egg.environmentJson });
  };
  const downloadEgg = async (id: number) => {
    const result = await exportEgg.mutateAsync({ id });
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `${result.egg.slug}.json`; link.click(); URL.revokeObjectURL(url);
  };
  const importEgg = () => {
    const raw = window.prompt("Paste an exported egg JSON");
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const nestId = Number(window.prompt("Nest ID for imported egg", String(nests.data?.[0]?.id || "")));
      if (!nestId || !data.egg) throw new Error("Invalid egg export");
      const { id: _ignoredId, ...egg } = data.egg;
      void _ignoredId;
      createEgg.mutate({ nestId, ...egg });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Invalid egg JSON"); }
  };

  return <section className="admin-card catalog-card"><div className="admin-card-heading"><div><span className="admin-card-kicker">Game templates</span><h2>Egg manager</h2></div><div><button onClick={newNest}><Plus size={14} />Nest</button><button onClick={newEgg}><Plus size={14} />Egg</button><button onClick={importEgg}><Upload size={14} />Import</button></div></div><div className="catalog-columns"><div><span className="catalog-label">Nests</span><div className="plan-pills">{(nests.data ?? []).map((nest) => <span key={nest.id}><strong>{nest.name}</strong><small>{nest.description}</small></span>)}</div></div><div><span className="catalog-label">Eggs</span><div className="plan-pills">{(eggs.data ?? []).map((egg) => <span key={egg.id}><strong>{egg.name}</strong><small>{egg.slug} · {egg.image}</small><button onClick={() => editEgg(egg)}><Pencil size={13} /></button><button onClick={() => void downloadEgg(egg.id)}><Download size={13} /></button><button onClick={() => deleteEgg.mutate({ id: egg.id })}><Trash2 size={13} /></button></span>)}</div></div></div></section>;
}
