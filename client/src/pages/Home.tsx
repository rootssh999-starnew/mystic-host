import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { hasOAuth, startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  Bell,
  Box,
  Boxes,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Cloud,
  Code2,
  Copy,
  Cpu,
  Database,
  Download,
  File,
  FileArchive,
  FileCode2,
  Folder,
  HardDrive,
  History,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Link2,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Wifi,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

type PanelKey = "Console" | "Files" | "Databases" | "Schedules" | "Users" | "Backups" | "Startup" | "Network" | "Settings" | "Activity";
type Tone = "cyan" | "lime" | "violet" | "amber" | "red";

type NavItem = { label: PanelKey; icon: LucideIcon; group: string };
const navItems: NavItem[] = [
  { label: "Console", icon: Terminal, group: "Manage" },
  { label: "Files", icon: Folder, group: "Manage" },
  { label: "Databases", icon: Database, group: "Manage" },
  { label: "Schedules", icon: CalendarClock, group: "Manage" },
  { label: "Users", icon: Users, group: "Manage" },
  { label: "Backups", icon: FileArchive, group: "Manage" },
  { label: "Startup", icon: Zap, group: "Configure" },
  { label: "Network", icon: Network, group: "Configure" },
  { label: "Settings", icon: Settings2, group: "Configure" },
  { label: "Activity", icon: History, group: "Configure" },
];

const servers = [
  { name: "signal-bot", label: "Production bot", state: "Running", tone: "cyan" as Tone, icon: "SB", usage: 68 },
  { name: "invoice-flow", label: "Automation worker", state: "Running", tone: "lime" as Tone, icon: "IF", usage: 42 },
  { name: "market-pulse", label: "Data monitor", state: "Offline", tone: "violet" as Tone, icon: "MP", usage: 0 },
  { name: "staging-lab", label: "Development sandbox", state: "Starting", tone: "amber" as Tone, icon: "SL", usage: 17 },
];

const files = [
  { name: "src", type: "folder", size: "—", modified: "Today, 09:42" },
  { name: "node_modules", type: "folder", size: "—", modified: "Today, 09:40" },
  { name: "package.json", type: "json", size: "3.8 KB", modified: "Today, 09:39" },
  { name: ".env.example", type: "env", size: "1.2 KB", modified: "Yesterday" },
  { name: "Dockerfile", type: "code", size: "2.4 KB", modified: "Sep 08, 2026" },
  { name: "README.md", type: "md", size: "8.1 KB", modified: "Sep 06, 2026" },
];

const activity = [
  ["Server started", "signal-bot", "Alex Morgan", "2 minutes ago", "cyan"],
  ["File uploaded", "signal-bot", "Alex Morgan", "18 minutes ago", "violet"],
  ["Variable updated", "signal-bot", "Jamie Chen", "43 minutes ago", "amber"],
  ["Backup completed", "invoice-flow", "System", "1 hour ago", "lime"],
  ["User invited", "signal-bot", "Alex Morgan", "3 hours ago", "cyan"],
];

function Logo() {
  return <div className="panel-logo"><span className="logo-orbit logo-orbit-one" /><span className="logo-orbit logo-orbit-two" /><span className="logo-core" /></div>;
}

function StatusPill({ children, tone = "cyan" }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={`status-pill status-pill-${tone}`}><i />{children}</span>;
}

function StatCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: LucideIcon; tone: Tone }) {
  return <div className="server-stat"><div className={`stat-icon stat-${tone}`}><Icon size={16} /></div><div className="server-stat-copy"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>;
}

function ConsoleView({ onAction, serverName }: { onAction: (action: string) => void; serverName: string }) {
  const logsQuery = trpc.node.logs.useQuery({ name: serverName }, { refetchInterval: 5000 });
  const commandMutation = trpc.node.command.useMutation({ onSuccess: (result) => onAction(result.output || "Command completed"), onError: (error) => onAction(error.message) });
  const [streamLogs, setStreamLogs] = useState<string | null>(null);
  useEffect(() => {
    const source = new EventSource(`/api/servers/${encodeURIComponent(serverName)}/events`);
    const handler = (event: MessageEvent<string>) => { try { setStreamLogs(JSON.parse(event.data).logs ?? ""); } catch { /* ignore malformed event */ } };
    source.addEventListener("logs", handler as EventListener);
    return () => source.close();
  }, [serverName]);
  const liveLogs = (streamLogs ?? logsQuery.data?.logs ?? "").split("\n").filter(Boolean);
  return <div className="console-layout">
    <div className="console-toolbar"><div className="console-toolbar-left"><StatusPill>Running</StatusPill><span className="console-live"><i />Live output</span></div><div className="console-actions"><button className="control-button control-warning" onClick={() => onAction("Restarting signal-bot…")}><RotateCcw size={14} />Restart</button><button className="control-button control-danger" onClick={() => onAction("Stopping signal-bot…")}><Square size={12} fill="currentColor" />Stop</button><button className="control-button control-muted" onClick={() => onAction("Kill signal-bot requested")}><AlertTriangle size={14} />Kill</button></div></div>
    <div className="console-window"><div className="console-window-bar"><div className="window-dots"><i /><i /><i /></div><span>{serverName} / console</span><button onClick={() => { navigator.clipboard?.writeText(logsQuery.data?.logs ?? ""); onAction("Console output copied"); }}><Copy size={13} />Copy output</button></div><div className="console-output">{logsQuery.isLoading ? <div className="log-line"><span className="log-message">Loading live Docker output…</span></div> : liveLogs.length ? liveLogs.map((line, i) => <div className="log-line" key={`${line}-${i}`}><span className="log-message">{line}</span></div>) : <div className="log-line"><span className="log-message">No container output yet. Upload your bot files and start the process.</span></div>}<div className="log-line log-cursor"><span className="log-message">_</span></div></div><div className="console-command"><span className="prompt">$</span><input placeholder="Send a command to the server..." disabled={commandMutation.isPending} onKeyDown={(event) => { if (event.key === "Enter" && event.currentTarget.value) { const command = event.currentTarget.value; commandMutation.mutate({ name: serverName, command }); event.currentTarget.value = ""; } }} /><button disabled={commandMutation.isPending} onClick={() => onAction("Enter a command and press Enter")}><ArrowUpToLine size={15} /></button></div></div>
    <div className="console-foot"><span><Wifi size={13} /> WebSocket connected</span><span><ClockIcon /> Auto-scroll on</span><span className="shortcut"><kbd>Ctrl</kbd> + <kbd>K</kbd> clear console</span></div>
  </div>;
}

function ClockIcon() { return <span className="clock-glyph">◷</span>; }

function formatBytes(bytes: number) {
  if (bytes < 1024) return String(bytes) + " B";
  if (bytes < 1024 * 1024) return String((bytes / 1024).toFixed(1)) + " KB";
  return String((bytes / (1024 * 1024)).toFixed(1)) + " MB";
}

function FilesView({ onAction, serverName }: { onAction: (action: string) => void; serverName: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const filesQuery = trpc.files.list.useQuery({ serverName });
  const sftpQuery = trpc.node.sftpCredentials.useQuery({ name: serverName });
  const uploadMutation = trpc.files.upload.useMutation({
    onSuccess: () => {
      void utils.files.list.invalidate({ serverName });
      onAction("File uploaded to storage");
    },
    onError: (error) => onAction(error.message),
  });
  const extractMutation = trpc.files.extract.useMutation({ onSuccess: () => onAction("Archive extracted on the Docker volume"), onError: (error) => onAction(error.message) });
  const deleteMutation = trpc.files.delete.useMutation({
    onSuccess: () => {
      void utils.files.list.invalidate({ serverName });
      onAction("File removed from storage metadata");
    },
    onError: (error) => onAction(error.message),
  });

  const uploadFile = (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      onAction("Files must be 10 MB or smaller");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      uploadMutation.mutate({ serverName, fileName: file.name, mimeType: file.type || "application/octet-stream", size: file.size, dataUrl: reader.result });
    };
    reader.readAsDataURL(file);
  };

  const rows = filesQuery.data ?? [];
  return <div className="subview"><div className="sftp-card"><div><span className="eyebrow">Secure transfer</span><h3>SFTP connection</h3><p>Use any SFTP client to transfer files directly to this server volume.</p></div>{sftpQuery.isLoading ? <span className="muted-text">Loading credentials…</span> : sftpQuery.data ? <div className="sftp-details"><code>{sftpQuery.data.username}@{sftpQuery.data.host}:{sftpQuery.data.port}</code><button className="outline-button" onClick={() => { navigator.clipboard?.writeText(`sftp://${sftpQuery.data.host}:${sftpQuery.data.port}`); onAction("SFTP address copied"); }}><Copy size={13} />Copy address</button><button className="outline-button" onClick={() => { navigator.clipboard?.writeText(sftpQuery.data.password); onAction("SFTP password copied"); }}><KeyRound size={13} />Copy password</button></div> : <span className="muted-text">SFTP details unavailable</span>}</div><div className="subview-toolbar"><div className="pathbar"><ChevronLeft size={15} /><span>/</span><strong>home</strong><span>/</span><strong>container</strong></div><div className="toolbar-actions"><input ref={fileInput} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadFile(file); event.currentTarget.value = ""; }} /><button className="outline-button" onClick={() => fileInput.current?.click()} disabled={uploadMutation.isPending}><Upload size={14} />{uploadMutation.isPending ? "Uploading..." : "Upload"}</button><button className="outline-button" onClick={() => onAction("New folder flow opened")}><Plus size={14} />New folder</button><button className="icon-action" onClick={() => onAction("More file actions opened")}><MoreHorizontal size={17} /></button></div></div><div className="file-tools"><div className="file-search"><Search size={14} /><input placeholder="Filter files..." /></div><span>{filesQuery.isLoading ? "Loading storage..." : String(rows.length) + " items · secure object storage"}</span></div>{filesQuery.isLoading ? <div className="storage-loading"><RefreshCw size={17} className="spin-icon" />Loading files from storage...</div> : rows.length === 0 ? <div className="empty-state storage-empty"><div><Folder size={21} /></div><strong>No uploaded files yet</strong><p>Upload a project file to store it securely for this server.</p><button onClick={() => fileInput.current?.click()}>Upload first file <Upload size={14} /></button></div> : <div className="data-table file-table"><div className="data-row data-head"><span><input type="checkbox" aria-label="Select all files" /></span><span>Name</span><span>Size</span><span>Uploaded</span><span /></div>{rows.map((file) => <div className="data-row" key={file.id}><span><input type="checkbox" aria-label={"Select " + file.originalName} /></span><span className="file-name"><span className="file-icon file-icon-code"><File size={16} /></span><strong>{file.originalName}</strong></span><span className="muted-text">{formatBytes(file.size)}</span><span className="muted-text">{new Date(file.createdAt).toLocaleString()}</span><>{file.originalName.toLowerCase().endsWith(".zip") && <button className="row-more" onClick={() => extractMutation.mutate({ serverName, fileName: file.originalName })} disabled={extractMutation.isPending}><FileArchive size={15} /></button>}<button className="row-more" onClick={() => { if (window.confirm("Remove " + file.originalName + " from this server?")) deleteMutation.mutate({ id: file.id }); }} disabled={deleteMutation.isPending}><Trash2 size={15} /></button></></div>)}</div>}<div className="file-tip"><ShieldCheck size={15} /><span>Files are stored in secure object storage. Up to 10 MB per upload.</span><button onClick={() => onAction("File editor opened")}>Open editor <ChevronRight size={14} /></button></div></div>;
}

function DatabasesView({ onAction }: { onAction: (action: string) => void }) {
  return <div className="subview"><div className="subview-heading"><div><span className="eyebrow">Persistent storage</span><h2>Databases</h2><p>Create databases that your server can reach over the private network.</p></div><button className="primary-button" onClick={() => onAction("Create database flow opened")}><Plus size={15} />New database</button></div><div className="database-grid"><div className="database-card"><div className="database-card-head"><div className="database-icon database-mysql"><Database size={18} /></div><StatusPill>Online</StatusPill></div><strong>signal_prod</strong><span>MySQL 8.0 · 14.2 MB</span><div className="database-meta"><span>Host <b>mysql.iad1</b></span><span>Port <b>3306</b></span></div><div className="database-actions"><button onClick={() => onAction("Database credentials copied")}><Copy size={13} />Credentials</button><button onClick={() => onAction("Database opened")}>Manage <ArrowUpToLine size={13} /></button></div></div><div className="database-card"><div className="database-card-head"><div className="database-icon database-redis"><Zap size={18} /></div><StatusPill tone="violet">Online</StatusPill></div><strong>signal_cache</strong><span>Redis 7.2 · 2.8 MB</span><div className="database-meta"><span>Host <b>redis.iad1</b></span><span>Port <b>6379</b></span></div><div className="database-actions"><button onClick={() => onAction("Database credentials copied")}><Copy size={13} />Credentials</button><button onClick={() => onAction("Database opened")}>Manage <ArrowUpToLine size={13} /></button></div></div></div><div className="empty-state database-empty"><div><Database size={21} /></div><strong>Need another data store?</strong><p>Postgres, MySQL, Redis, and SQLite templates are ready to attach.</p><button onClick={() => onAction("Database catalog opened")}>Browse templates <ArrowUpToLine size={14} /></button></div></div>;
}

function SchedulesView({ onAction }: { onAction: (action: string) => void }) {
  const schedules = [{ name: "Health heartbeat", cadence: "Every 5 minutes", command: "npm run heartbeat", status: "Active", last: "2 min ago" }, { name: "Daily data digest", cadence: "Every day at 08:00 UTC", command: "node scripts/digest.js", status: "Active", last: "Yesterday" }, { name: "Weekly cleanup", cadence: "Every Sunday at 03:00 UTC", command: "npm run cleanup", status: "Paused", last: "Sep 06" }];
  return <div className="subview"><div className="subview-heading"><div><span className="eyebrow">Automated actions</span><h2>Schedules</h2><p>Run commands on a cadence without keeping a browser open.</p></div><button className="primary-button" onClick={() => onAction("New schedule flow opened")}><Plus size={15} />New schedule</button></div><div className="schedule-list">{schedules.map((schedule) => <div className="schedule-card" key={schedule.name}><div className="schedule-icon"><CalendarClock size={18} /></div><div className="schedule-main"><div className="schedule-title"><strong>{schedule.name}</strong><StatusPill tone={schedule.status === "Active" ? "cyan" : "amber"}>{schedule.status}</StatusPill></div><code>{schedule.command}</code><span>{schedule.cadence} · Last run {schedule.last}</span></div><div className="schedule-actions"><button className="icon-action" onClick={() => onAction(`${schedule.name} toggled`)}>{schedule.status === "Active" ? <Pause size={15} /> : <Play size={15} />}</button><button className="icon-action" onClick={() => onAction(`${schedule.name} settings opened`)}><Settings2 size={15} /></button><button className="icon-action" onClick={() => onAction(`${schedule.name} actions opened`)}><MoreHorizontal size={16} /></button></div></div>)}</div></div>;
}

function UsersView({ onAction }: { onAction: (action: string) => void }) {
  return <div className="subview"><div className="subview-heading"><div><span className="eyebrow">Access control</span><h2>Users & permissions</h2><p>Choose who can access this server and what they can do.</p></div><button className="primary-button" onClick={() => onAction("Invite user flow opened")}><UserPlus size={15} />Invite user</button></div><div className="data-table user-table"><div className="data-row data-head"><span>User</span><span>Role</span><span>2FA</span><span>Last active</span><span /></div>{[{ n: "Alex Morgan", e: "alex@acme.dev", initials: "AM", role: "Owner", two: true, active: "Just now" }, { n: "Jamie Chen", e: "jamie@acme.dev", initials: "JC", role: "Developer", two: true, active: "12 min ago" }, { n: "Deploy bot", e: "automation@mystic-host.run", initials: "DB", role: "Service account", two: false, active: "18 min ago" }].map((user) => <div className="data-row" key={user.e}><span className="member"><span className="member-avatar">{user.initials}</span><span><strong>{user.n}</strong><small>{user.e}</small></span></span><span className="role-chip">{user.role}</span><span>{user.two ? <Check className="table-check" size={15} /> : <span className="muted-text">Off</span>}</span><span className="muted-text">{user.active}</span><button className="row-more" onClick={() => onAction(`${user.n} permissions opened`)}><MoreHorizontal size={16} /></button></div>)}</div></div>;
}

function BackupsView({ onAction, serverName }: { onAction: (action: string) => void; serverName: string }) {
  const utils = trpc.useUtils();
  const query = trpc.node.backups.useQuery({ name: serverName });
  const create = trpc.node.createBackup.useMutation({ onSuccess: () => { void utils.node.backups.invalidate({ name: serverName }); onAction("Backup created"); }, onError: e => onAction(e.message) });
  const restore = trpc.node.restoreBackup.useMutation({ onSuccess: () => onAction("Backup restored"), onError: e => onAction(e.message) });
  const backups = query.data?.backups ?? [];
  return <div className="subview"><div className="subview-heading"><div><span className="eyebrow">Recovery points</span><h2>Backups</h2><p>Live snapshots from the Docker server volume.</p></div><button className="primary-button" onClick={() => create.mutate({ name: serverName })} disabled={create.isPending}><Plus size={15} />{create.isPending ? "Creating…" : "Create backup"}</button></div><div className="backup-banner"><div className="backup-banner-icon"><ShieldCheck size={19} /></div><div><strong>{query.isLoading ? "Loading backups…" : backups.length + " recovery point" + (backups.length === 1 ? "" : "s")}</strong><span>Backups are stored outside the live server volume.</span></div></div>{query.isLoading ? <div className="storage-loading"><RefreshCw size={17} className="spin-icon" />Loading backups…</div> : backups.length === 0 ? <div className="empty-state"><div><FileArchive size={21} /></div><strong>No backups yet</strong><p>Create a recovery point before making changes.</p></div> : <div className="data-table backup-table"><div className="data-row data-head"><span>Backup</span><span>Size</span><span>Created</span><span>Status</span><span /></div>{backups.map(backup => <div className="data-row" key={backup.name}><span className="backup-name"><FileArchive size={16} />{backup.name}</span><span className="muted-text">{formatBytes(backup.bytes)}</span><span className="muted-text">{new Date(backup.createdAt).toLocaleString()}</span><StatusPill>Ready</StatusPill><button className="row-more" onClick={() => restore.mutate({ name: serverName, backupName: backup.name })} disabled={restore.isPending}><RotateCcw size={15} /></button></div>)}</div>}</div>;
}
function StartupView({ onAction }: { onAction: (action: string) => void }) {
  const vars = [{ key: "NODE_ENV", value: "production", secret: false }, { key: "DISCORD_TOKEN", value: "••••••••••••••••", secret: true }, { key: "LOG_LEVEL", value: "info", secret: false }, { key: "WEBHOOK_SECRET", value: "••••••••••••••••", secret: true }];
  return <div className="subview"><div className="subview-heading"><div><span className="eyebrow">Runtime configuration</span><h2>Startup variables</h2><p>Variables are injected when the server starts. Secrets are encrypted at rest.</p></div><button className="primary-button" onClick={() => onAction("Variable added")}><Plus size={15} />Add variable</button></div><div className="startup-card"><div className="startup-card-head"><div><strong>Node.js 22 · production</strong><span>Command: <code>npm run start</code></span></div><button className="outline-button" onClick={() => onAction("Startup command editor opened")}><Settings2 size={14} />Edit startup</button></div><div className="variable-table">{vars.map((variable) => <div className="variable-row" key={variable.key}><code>{variable.key}</code><span className={variable.secret ? "secret-value" : "variable-value"}>{variable.value}</span><button className="row-more" onClick={() => onAction(`${variable.key} copied`)}><Copy size={14} /></button><button className="row-more" onClick={() => onAction(`${variable.key} settings opened`)}><MoreHorizontal size={16} /></button></div>)}</div></div><div className="warning-note"><AlertTriangle size={16} /><div><strong>Changing startup settings restarts this server.</strong><span>Make sure your command and variables match your project before saving.</span></div></div></div>;
}

function NetworkView({ onAction }: { onAction: (action: string) => void }) {
  return <div className="subview"><div className="subview-heading"><div><span className="eyebrow">Public endpoints</span><h2>Network & allocations</h2><p>Manage ports, domains, and private connectivity for this server.</p></div><button className="primary-button" onClick={() => onAction("Allocation added")}><Plus size={15} />Create allocation</button></div><div className="network-grid"><div className="allocation-card allocation-primary"><div className="allocation-head"><div className="allocation-icon"><Network size={17} /></div><StatusPill>Primary</StatusPill></div><strong>iad1.mystic-host.run:30124</strong><span>Public · TCP · IPv4</span><div className="allocation-foot"><button onClick={() => onAction("Allocation address copied")}><Copy size={13} />Copy address</button><button onClick={() => onAction("Domain attach flow opened")}><Link2 size={13} />Attach domain</button></div></div><div className="allocation-card"><div className="allocation-head"><div className="allocation-icon allocation-violet"><Cloud size={17} /></div><StatusPill tone="violet">Private</StatusPill></div><strong>signal-bot.internal:8080</strong><span>Private network · HTTP</span><div className="allocation-foot"><button onClick={() => onAction("Private URL copied")}><Copy size={13} />Copy URL</button><button onClick={() => onAction("Private network opened")}><Network size={13} />Inspect</button></div></div></div><div className="domain-card"><GlobeIcon /><div><strong>Custom domains</strong><span>Point your own domain at a public allocation.</span></div><button onClick={() => onAction("Custom domain flow opened")}>Add domain <Plus size={13} /></button></div></div>;
}
function GlobeIcon() { return <span className="domain-icon"><Network size={17} /></span>; }

function SettingsView({ onAction }: { onAction: (action: string) => void }) {
  return <div className="subview"><div className="subview-heading"><div><span className="eyebrow">Server lifecycle</span><h2>Server settings</h2><p>Control the identity, power behavior, and destructive actions for this server.</p></div></div><div className="settings-grid"><div className="settings-card"><div className="settings-card-head"><Settings2 size={17} /><strong>General settings</strong></div><label>Server name<input defaultValue="signal-bot" /></label><label>Description<textarea defaultValue="Realtime Discord intelligence and event processing." /></label><button className="primary-button" onClick={() => onAction("Server settings saved")}><Check size={15} />Save changes</button></div><div className="settings-card"><div className="settings-card-head"><ShieldCheck size={17} /><strong>Power behavior</strong></div><div className="toggle-row"><span><strong>Auto-start on crash</strong><small>Restart after an unexpected exit.</small></span><button className="toggle toggle-on" onClick={() => onAction("Auto-start toggled")}><i /></button></div><div className="toggle-row"><span><strong>Announce maintenance</strong><small>Notify collaborators before a restart.</small></span><button className="toggle toggle-on" onClick={() => onAction("Maintenance alerts toggled")}><i /></button></div><div className="toggle-row"><span><strong>Install updates automatically</strong><small>Only patch-level runtime updates.</small></span><button className="toggle" onClick={() => onAction("Automatic updates toggled")}><i /></button></div></div></div><div className="danger-zone"><div><strong>Danger zone</strong><span>These actions affect production data and cannot be undone.</span></div><div><button onClick={() => onAction("Transfer server flow opened")}><ArrowDownToLine size={14} />Transfer server</button><button className="danger-button" onClick={() => onAction("Delete confirmation required")}><Trash2 size={14} />Delete server</button></div></div></div>;
}

function ActivityView() {
  return <div className="subview"><div className="subview-heading"><div><span className="eyebrow">Audit trail</span><h2>Activity log</h2><p>Every important change to this server, in one place.</p></div><button className="outline-button"><Download size={14} />Export CSV</button></div><div className="data-table activity-table"><div className="data-row data-head"><span>Event</span><span>Server</span><span>Actor</span><span>When</span><span /></div>{activity.map(([event, server, actor, time, tone]) => <div className="data-row" key={`${event}-${time}`}><span className="activity-event"><span className={`activity-dot activity-dot-${tone}`} />{event}</span><span className="muted-text">{server}</span><span className="muted-text">{actor}</span><span className="muted-text">{time}</span><ChevronRight size={15} className="muted-icon" /></div>)}</div></div>;
}

function HomeLogin() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { const response = await fetch("/api/local/login", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ email, password }) }); if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Login failed"); window.location.reload(); } catch (err) { setError(err instanceof Error ? err.message : "Login failed"); setBusy(false); } };
  return <div className="auth-screen"><form className="auth-card" onSubmit={submit}><div className="auth-mark">MH</div><p className="eyebrow">MYSTIC HOST</p><h1>Sign in to continue</h1><p className="muted-text">Use your administrator account to access the control panel.</p>{hasOAuth ? <button type="button" className="primary-button" onClick={() => startLogin()}>Sign in with OAuth</button> : <><label>Email<input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label><button className="primary-button" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></>}{error && <p className="auth-error">{error}</p>}</form></div>;
}

export default function Home() {
  const { user, loading, logout } = useAuth();

  const [activePanel, setActivePanel] = useState<PanelKey>("Console");
  const [activeServer, setActiveServer] = useState(servers[0]);
  const [serverMenuOpen, setServerMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [serverRunning, setServerRunning] = useState(true);
  const nodeActionMutation = trpc.node.action.useMutation({
    onSuccess: (result) => {
      setServerRunning(result.running);
      toast(`Server ${result.running ? "started" : "stopped"}`, { description: `${activeServer.name} is connected to the live Docker node.` });
    },
    onError: (error) => toast("Node action failed", { description: error.message }),
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen(true); }
      if (event.key === "Escape") { setCommandOpen(false); setServerMenuOpen(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (loading) return <div className="auth-screen"><div className="auth-card"><h1>Loading MYSTIC HOST…</h1></div></div>;
  if (!user) return <HomeLogin />;

  const action = (message: string) => toast(message, { description: "This control plane action is ready to connect to your runtime API." });
  const grouped = useMemo(() => ({ Manage: navItems.filter((item) => item.group === "Manage"), Configure: navItems.filter((item) => item.group === "Configure") }), []);
  const selectPanel = (panel: PanelKey) => { setActivePanel(panel); setSidebarOpen(false); };
  const powerAction = (next: "start" | "stop" | "restart") => {
    toast(`${next[0].toUpperCase()}${next.slice(1)}ing ${activeServer.name}…`, { description: "Calling the live Docker node." });
    nodeActionMutation.mutate({ name: activeServer.name, action: next });
  };

  const renderPanel = () => {
    const props = { onAction: action };
    if (activePanel === "Console") return <ConsoleView {...props} serverName={activeServer.name} onAction={(message) => { if (message.startsWith("Stopping")) setServerRunning(false); if (message.startsWith("Restarting")) setServerRunning(true); action(message); }} />;
    if (activePanel === "Files") return <FilesView {...props} serverName={activeServer.name} />;
    if (activePanel === "Databases") return <DatabasesView {...props} />;
    if (activePanel === "Schedules") return <SchedulesView {...props} />;
    if (activePanel === "Users") return <UsersView {...props} />;
    if (activePanel === "Backups") return <BackupsView {...props} serverName={activeServer.name} />;
    if (activePanel === "Startup") return <StartupView {...props} />;
    if (activePanel === "Network") return <NetworkView {...props} />;
    if (activePanel === "Settings") return <SettingsView {...props} />;
    return <ActivityView />;
  };

  return <div className="control-plane">
    <aside className={`panel-sidebar ${sidebarOpen ? "panel-sidebar-open" : ""}`}>
      <div className="sidebar-brand"><Logo /><div><strong>mystic-host<span>°</span></strong><small>control plane</small></div><button className="sidebar-close" onClick={() => setSidebarOpen(false)}><X size={17} /></button></div>
      <div className="account-switch"><span className="account-avatar">A</span><span><strong>Acme workspace</strong><small>Production account</small></span><ChevronDown size={14} /></div>
      <div className="server-switcher-wrap"><span className="sidebar-label">Your servers</span><button className="server-switcher" onClick={() => setServerMenuOpen(!serverMenuOpen)}><span className={`server-avatar server-avatar-${activeServer.tone}`}>{activeServer.icon}</span><span><strong>{activeServer.name}</strong><small><i className={`dot dot-${activeServer.tone}`} />{activeServer.state}</small></span><ChevronDown size={14} /></button>{serverMenuOpen && <div className="server-menu">{servers.map((server) => <button key={server.name} onClick={() => { setActiveServer(server); setServerRunning(server.state === "Running"); setServerMenuOpen(false); action(`Switched to ${server.name}`); }}><span className={`server-avatar server-avatar-${server.tone}`}>{server.icon}</span><span><strong>{server.name}</strong><small>{server.label}</small></span>{server.name === activeServer.name && <Check size={14} />}</button>)}<div className="server-menu-foot"><Plus size={13} />Create new server</div></div>}</div>
      <nav className="panel-nav">{(["Manage", "Configure"] as const).map((group) => <div className="panel-nav-group" key={group}><span className="sidebar-label">{group}</span>{grouped[group].map(({ label, icon: Icon }) => <button key={label} className={`panel-nav-item ${activePanel === label ? "panel-nav-active" : ""}`} onClick={() => selectPanel(label)}><Icon size={16} /><span>{label}</span>{label === "Console" && <span className="nav-live" />}</button>)}</div>)}</nav>
      <div className="sidebar-bottom"><div className="node-health"><span className="health-icon"><Activity size={14} /></span><span><strong>Node healthy</strong><small>iad1 · 12ms latency</small></span><i /></div><div className="sidebar-links"><button onClick={() => { if (user?.role === "admin") window.location.href = "/admin"; else action("Admin access requires an administrator role"); }}><ShieldCheck size={15} />Admin console</button><button onClick={() => action("Support center opened")}><LifeBuoy size={15} />Support</button><button onClick={() => action("Documentation opened")}><CircleHelp size={15} />Docs</button></div><div className="signed-in"><span className="user-avatar">AM</span><span><strong>{user?.name ?? "Alex Morgan"}</strong><small>{user?.role === "admin" ? "Admin" : "Owner"}</small></span><button className="logout-button" onClick={logout} title="Log out">Log out</button></div></div>
    </aside>
    <main className="panel-main">
      <header className="panel-topbar"><button className="mobile-panel-menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><div className="panel-breadcrumb"><span>Servers</span><ChevronRight size={13} /><strong>{activeServer.name}</strong><ChevronRight size={13} /><span>{activePanel}</span></div><div className="topbar-right"><button className="global-search" onClick={() => setCommandOpen(true)}><Search size={15} /><span>Search anything</span><kbd>⌘ K</kbd></button><button className="topbar-icon" onClick={() => action("No new notifications")}><Bell size={17} /><i /></button><button className="topbar-help" onClick={() => action("Help center opened")}><CircleHelp size={16} /></button></div></header>
      <div className="panel-content">
        <section className="server-header"><div className="server-header-title"><div className={`large-server-icon server-avatar-${activeServer.tone}`}>{activeServer.icon}</div><div><div className="server-title-line"><h1>{activeServer.name}</h1><StatusPill tone={serverRunning ? "cyan" : "red"}>{serverRunning ? "Running" : "Offline"}</StatusPill></div><p>{activeServer.label} <span>·</span> Node.js 22 <span>·</span> iad1 / United States</p></div></div><div className="power-controls"><button className="power-button power-start" onClick={() => powerAction("start")} disabled={serverRunning || nodeActionMutation.isPending}><Play size={14} fill="currentColor" />Start</button><button className="power-button power-restart" onClick={() => powerAction("restart")} disabled={nodeActionMutation.isPending}><RotateCcw size={14} />Restart</button><button className="power-button power-stop" onClick={() => powerAction("stop")} disabled={!serverRunning || nodeActionMutation.isPending}><Square size={11} fill="currentColor" />Stop</button><button className="power-more" onClick={() => action("Power actions opened")}><MoreHorizontal size={17} /></button></div></section>
        <section className="resource-strip"><StatCard label="CPU usage" value={`${activeServer.usage}%`} detail="2 vCPU allocated" icon={Cpu} tone="cyan" /><StatCard label="Memory" value={activeServer.name === "signal-bot" ? "186 MiB" : "412 MiB"} detail="1 GiB allocated" icon={Activity} tone="violet" /><StatCard label="Storage" value="14.2 GB" detail="50 GB allocated" icon={HardDrive} tone="lime" /><StatCard label="Network" value="42 ms" detail="iad1 → Discord" icon={Wifi} tone="amber" /><div className="resource-graph"><div className="resource-graph-head"><span>Resource usage</span><span className="graph-live"><i />Live</span></div><svg viewBox="0 0 190 48" preserveAspectRatio="none"><defs><linearGradient id="fill-cyan" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#6bf6d2" stopOpacity=".28" /><stop offset="1" stopColor="#6bf6d2" stopOpacity="0" /></linearGradient></defs><path d="M0 40 C12 36 16 38 25 31 S42 33 50 27 S66 31 76 20 S92 25 102 19 S121 24 129 13 S144 20 153 14 S167 18 190 5 L190 48 L0 48Z" fill="url(#fill-cyan)" /><path d="M0 40 C12 36 16 38 25 31 S42 33 50 27 S66 31 76 20 S92 25 102 19 S121 24 129 13 S144 20 153 14 S167 18 190 5" fill="none" stroke="#6bf6d2" strokeWidth="1.5" /></svg></div></section>
        <div className="panel-view-heading"><div><span className="view-eyebrow">{activePanel === "Console" ? "Live process" : "Server workspace"}</span><h2>{activePanel}</h2></div><div className="view-heading-actions">{activePanel === "Console" ? <><span className="last-deploy"><Check size={13} /> Deployed 12 min ago</span><button className="outline-button" onClick={() => action("Deployment details opened")}><Box size={14} />Deployment</button></> : <span className="server-id">Server ID <code>svr_8L4mJ9xQ</code><Copy size={13} /></span>}</div></div>
        {renderPanel()}
      </div>
      <footer className="panel-footer"><span><i className="footer-dot" />All systems operational</span><span>API v1 · mystic-host° control plane</span><span>Region iad1 <span className="footer-separator">·</span> v1.8.0</span></footer>
    </main>
    {commandOpen && <div className="command-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommandOpen(false); }}><div className="command-panel"><div className="command-input"><Search size={17} /><input autoFocus placeholder="Search servers, files, settings..." /><kbd>esc</kbd></div><div className="command-list"><span>Quick navigation</span>{navItems.slice(0, 6).map(({ label, icon: Icon }) => <button key={label} onClick={() => { selectPanel(label); setCommandOpen(false); }}><Icon size={16} /><strong>{label}</strong><small>Open server {label.toLowerCase()}</small><kbd>↵</kbd></button>)}</div><div className="command-foot"><span><kbd>↑↓</kbd> navigate</span><span><kbd>↵</kbd> select</span><span><kbd>esc</kbd> close</span></div></div></div>}
  </div>;
}
