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
  const lifecycleMutation = trpc.node.action.useMutation({ onSuccess: (result) => onAction("Server is " + (result.running ? "running" : "offline")), onError: (error) => onAction(error.message) });
  const [streamLogs, setStreamLogs] = useState<string | null>(null);
  useEffect(() => {
    const source = new EventSource(`/api/servers/${encodeURIComponent(serverName)}/events`);
    const handler = (event: MessageEvent<string>) => { try { setStreamLogs(JSON.parse(event.data).logs ?? ""); } catch { /* ignore malformed event */ } };
    source.addEventListener("logs", handler as EventListener);
    return () => source.close();
  }, [serverName]);
  const liveLogs = (streamLogs ?? logsQuery.data?.logs ?? "").split("\n").filter(Boolean);
  return <div className="console-layout">
    <div className="console-toolbar"><div className="console-toolbar-left"><StatusPill>{lifecycleMutation.isPending ? "Updating" : "Running"}</StatusPill><span className="console-live"><i />Live output</span></div><div className="console-actions"><button className="control-button control-warning" onClick={() => lifecycleMutation.mutate({ name: serverName, action: "restart" })} disabled={lifecycleMutation.isPending}><RotateCcw size={14} />Restart</button><button className="control-button control-danger" onClick={() => lifecycleMutation.mutate({ name: serverName, action: "stop" })} disabled={lifecycleMutation.isPending}><Square size={12} fill="currentColor" />Stop</button><button className="control-button control-muted" onClick={() => { if (window.confirm("Force kill the server process?")) lifecycleMutation.mutate({ name: serverName, action: "kill" }); }} disabled={lifecycleMutation.isPending}><AlertTriangle size={14} />Kill</button></div></div>
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
  const createFolderMutation = trpc.files.createFolder.useMutation({ onSuccess: (result) => { void utils.node.listFiles.invalidate({ name: serverName }); onAction("Folder created: " + result.path); }, onError: (error) => onAction(error.message) });
  const fileInput = useRef<HTMLInputElement>(null);
  const [livePath, setLivePath] = useState("");
  const [editorFile, setEditorFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const readTextMutation = trpc.files.readText.useMutation({ onSuccess: (result) => { setEditorFile(result.fileName); setEditorContent(result.content); }, onError: (error) => onAction(error.message) });
  const writeTextMutation = trpc.files.writeText.useMutation({ onSuccess: () => { void utils.node.listFiles.invalidate({ name: serverName }); onAction("File saved to the live workspace"); }, onError: (error) => onAction(error.message) });
  const utils = trpc.useUtils();
  const filesQuery = trpc.files.list.useQuery({ serverName });
  const liveFilesQuery = trpc.node.listFiles.useQuery({ name: serverName, path: livePath || undefined });
  const renameLiveMutation = trpc.files.renameLive.useMutation({ onSuccess: () => { void liveFilesQuery.refetch(); onAction("Live entry renamed"); }, onError: (error) => onAction(error.message) });
  const deleteLiveMutation = trpc.files.deleteLive.useMutation({ onSuccess: () => { void liveFilesQuery.refetch(); onAction("Live entry deleted"); }, onError: (error) => onAction(error.message) });
  const sftpQuery = trpc.node.sftpCredentials.useQuery({ name: serverName });
  const uploadMutation = trpc.files.upload.useMutation({
    onSuccess: () => {
      void utils.files.list.invalidate({ serverName });
      void utils.node.listFiles.invalidate({ name: serverName });
      onAction("File uploaded to storage");
    },
    onError: (error) => onAction(error.message),
  });
  const extractMutation = trpc.files.extract.useMutation({ onSuccess: () => onAction("Archive extracted on the Docker volume"), onError: (error) => onAction(error.message) });
  const renameMutation = trpc.files.rename.useMutation({ onSuccess: () => { void utils.files.list.invalidate({ serverName }); void utils.node.listFiles.invalidate({ name: serverName }); onAction("File renamed on the live workspace"); }, onError: (error) => onAction(error.message) });
  const deleteMutation = trpc.files.delete.useMutation({
    onSuccess: () => {
      void utils.files.list.invalidate({ serverName });
      void utils.node.listFiles.invalidate({ name: serverName });
      onAction("File removed from the live workspace");
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
      uploadMutation.mutate({ serverName, fileName: [livePath, file.name].filter(Boolean).join("/"), mimeType: file.type || "application/octet-stream", size: file.size, dataUrl: reader.result });
    };
    reader.readAsDataURL(file);
  };

  const rows = filesQuery.data ?? [];
  const liveRows = liveFilesQuery.data?.files ?? [];
  const enterLiveFolder = (entry: (typeof liveRows)[number]) => { if (entry.directory) setLivePath(entry.path === "." ? "" : entry.path); };
  const goLiveParent = () => setLivePath(livePath.includes("/") ? livePath.slice(0, livePath.lastIndexOf("/")) : "");
  const downloadLiveFile = async (entry: (typeof liveRows)[number]) => { if (entry.directory) return; try { const result = await utils.node.downloadFile.fetch({ name: serverName, path: entry.path }); const bytes = Uint8Array.from(atob(result.dataBase64), (char) => char.charCodeAt(0)); const url = URL.createObjectURL(new Blob([bytes])); const anchor = document.createElement("a"); anchor.href = url; anchor.download = entry.name; anchor.click(); URL.revokeObjectURL(url); onAction("Downloaded " + entry.name); } catch (error) { onAction(error instanceof Error ? error.message : "Download failed"); } };
  return <div className="subview"><div className="sftp-card"><div><span className="eyebrow">Secure transfer</span><h3>SFTP connection</h3><p>Use any SFTP client to transfer files directly to this server volume.</p></div>{sftpQuery.isLoading ? <span className="muted-text">Loading credentials…</span> : sftpQuery.data ? <div className="sftp-details"><code>{sftpQuery.data.username}@{sftpQuery.data.host}:{sftpQuery.data.port}</code><button className="outline-button" onClick={() => { navigator.clipboard?.writeText(`sftp://${sftpQuery.data.host}:${sftpQuery.data.port}`); onAction("SFTP address copied"); }}><Copy size={13} />Copy address</button><button className="outline-button" onClick={() => { navigator.clipboard?.writeText(sftpQuery.data.password); onAction("SFTP password copied"); }}><KeyRound size={13} />Copy password</button></div> : <span className="muted-text">SFTP details unavailable</span>}</div><div className="subview-toolbar"><div className="pathbar"><button className="icon-action" onClick={goLiveParent} disabled={!livePath} title="Go up"><ChevronLeft size={15} /></button><span>/workspace</span>{livePath.split("/").filter(Boolean).map((part, index, parts) => <span key={part}> / <button className="path-crumb" onClick={() => setLivePath(parts.slice(0, index + 1).join("/"))}>{part}</button></span>)}</div><div className="toolbar-actions"><input ref={fileInput} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadFile(file); event.currentTarget.value = ""; }} /><button className="outline-button" onClick={() => fileInput.current?.click()} disabled={uploadMutation.isPending}><Upload size={14} />{uploadMutation.isPending ? "Uploading..." : "Upload"}</button><button className="outline-button" onClick={() => { const folderName = window.prompt("New folder name", "new-folder"); if (folderName?.trim()) createFolderMutation.mutate({ serverName, folderName: [livePath, folderName.trim()].filter(Boolean).join("/") }); }} disabled={createFolderMutation.isPending}><Plus size={14} />{createFolderMutation.isPending ? "Creating..." : "New folder"}</button><button className="icon-action" onClick={() => onAction("More file actions opened")}><MoreHorizontal size={17} /></button></div></div><div className="live-workspace-card"><div className="file-editor-head"><div><strong>Live workspace</strong><span>Directly read from the Docker volume.</span></div><button className="icon-action" onClick={() => liveFilesQuery.refetch()}><RefreshCw size={15} className={liveFilesQuery.isFetching ? "spin-icon" : ""} /></button></div>{liveFilesQuery.isLoading ? <div className="storage-loading">Loading live workspace…</div> : liveRows.length === 0 ? <div className="muted-text">Workspace is empty.</div> : <div className="live-file-list">{liveRows.slice(0, 40).map((entry) => <div className="live-file-row" key={entry.path}><button className="live-file-open" onClick={() => enterLiveFolder(entry)} disabled={!entry.directory} title={entry.directory ? "Open folder" : "File"}><span>{entry.directory ? <Folder size={15} /> : <File size={15} />}</span><code>{entry.name}</code></button><span className="muted-text">{entry.directory ? "folder" : formatBytes(entry.bytes)}</span>{!entry.directory && <button className="row-more" onClick={() => void downloadLiveFile(entry)} title="Download file"><Download size={14} /></button>}<button className="row-more" onClick={() => { const next = window.prompt("Rename", entry.name); if (next?.trim() && next.trim() !== entry.name) renameLiveMutation.mutate({ serverName, fileName: entry.path, newName: next.trim() }); }} title="Rename"><Settings2 size={14} /></button><button className="row-more" onClick={() => { if (window.confirm("Delete " + entry.name + " from the live workspace?")) deleteLiveMutation.mutate({ serverName, fileName: entry.path }); }} title="Delete"><Trash2 size={14} /></button></div>)}</div>}</div><div className="file-tools"><div className="file-search"><Search size={14} /><input placeholder="Filter files..." /></div><span>{filesQuery.isLoading ? "Loading storage..." : String(rows.length) + " items · secure object storage"}</span></div>{filesQuery.isLoading ? <div className="storage-loading"><RefreshCw size={17} className="spin-icon" />Loading files from storage...</div> : rows.length === 0 ? <div className="empty-state storage-empty"><div><Folder size={21} /></div><strong>No uploaded files yet</strong><p>Upload a project file to store it securely for this server.</p><button onClick={() => fileInput.current?.click()}>Upload first file <Upload size={14} /></button></div> : <div className="data-table file-table"><div className="data-row data-head"><span><input type="checkbox" aria-label="Select all files" /></span><span>Name</span><span>Size</span><span>Uploaded</span><span /></div>{rows.map((file) => <div className="data-row" key={file.id}><span><input type="checkbox" aria-label={"Select " + file.originalName} /></span><span className="file-name"><span className="file-icon file-icon-code"><File size={16} /></span><strong>{file.originalName}</strong></span><span className="muted-text">{formatBytes(file.size)}</span><span className="muted-text">{new Date(file.createdAt).toLocaleString()}</span><>{file.originalName.toLowerCase().endsWith(".zip") && <button className="row-more" onClick={() => extractMutation.mutate({ serverName, fileName: file.originalName })} disabled={extractMutation.isPending}><FileArchive size={15} /></button>}<button className="row-more" onClick={() => { const next = window.prompt("Rename file", file.originalName); if (next && next.trim() !== file.originalName) renameMutation.mutate({ id: file.id, newName: next.trim() }); }} disabled={renameMutation.isPending}><Settings2 size={15} /></button><button className="row-more" onClick={() => { if (window.confirm("Remove " + file.originalName + " from this server?")) deleteMutation.mutate({ id: file.id }); }} disabled={deleteMutation.isPending}><Trash2 size={15} /></button></></div>)}</div>}<div className="file-editor-card"><div className="file-editor-head"><strong>{editorFile ? "Editing " + editorFile : "Live text editor"}</strong><button className="icon-action" onClick={() => setEditorFile(null)}>×</button></div>{editorFile && <><textarea className="file-editor-textarea" value={editorContent} onChange={(event) => setEditorContent(event.target.value)} spellCheck={false} /><div className="file-editor-actions"><span className="muted-text">256 KB maximum · plain text</span><button className="primary-button" onClick={() => writeTextMutation.mutate({ serverName, fileName: editorFile.includes("/") ? editorFile : [livePath, editorFile].filter(Boolean).join("/"), content: editorContent })} disabled={writeTextMutation.isPending}>{writeTextMutation.isPending ? "Saving..." : "Save file"}</button></div></>}</div><div className="file-tip"><ShieldCheck size={15} /><span>Files are stored in secure object storage. Up to 10 MB per upload.</span><button onClick={() => { const fileName = window.prompt("Text file to edit", rows[0]?.originalName || "server.js"); if (fileName?.trim()) readTextMutation.mutate({ serverName, fileName: [livePath, fileName.trim()].filter(Boolean).join("/") }); }} disabled={readTextMutation.isPending}>Open editor <ChevronRight size={14} /></button></div></div>;
}

function DatabasesView({ onAction, serverName }: { onAction: (action: string) => void; serverName: string }) {
  const utils = trpc.useUtils();
  const query = trpc.node.listDatabases.useQuery({ serverName });
  const [name, setName] = useState(""); const [username, setUsername] = useState("app"); const [password, setPassword] = useState("");
  const create = trpc.node.createDatabase.useMutation({ onSuccess: result => { void utils.node.listDatabases.invalidate({ serverName }); onAction("Database " + result.name + " created"); setName(""); setPassword(""); }, onError: e => onAction(e.message) });
  const remove = trpc.node.deleteDatabase.useMutation({ onSuccess: result => { void utils.node.listDatabases.invalidate({ serverName }); onAction("Database " + result.database + " deleted"); }, onError: e => onAction(e.message) });
  const rotate = trpc.node.rotateDatabasePassword.useMutation({ onSuccess: result => { onAction("Password rotated for " + result.database); }, onError: e => onAction(e.message) });
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!name || password.length < 12) { onAction("Database name and a 12-character password are required"); return; } create.mutate({ serverName, name, username, password }); };
  const databases = query.data?.databases ?? [];
  return <div className="subview"><div className="subview-heading"><div><span className="eyebrow">Persistent storage</span><h2>Databases</h2><p>Live MySQL containers attached to this server.</p></div></div><form className="settings-card database-create-form" onSubmit={submit}><div className="settings-card-head"><Database size={17} /><strong>Create MySQL database</strong></div><div className="database-form-grid"><label>Database name<input value={name} onChange={event => setName(event.target.value.replace(/[^a-zA-Z0-9_-]/g, "_"))} placeholder="my_app" required /></label><label>Username<input value={username} onChange={event => setUsername(event.target.value.replace(/[^a-zA-Z0-9_-]/g, "_"))} required /></label><label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={12} placeholder="At least 12 characters" required /></label></div><button className="primary-button" type="submit" disabled={create.isPending}><Plus size={15} />{create.isPending ? "Creating…" : "Create database"}</button></form>{query.isLoading ? <div className="storage-loading">Loading databases…</div> : databases.length === 0 ? <div className="empty-state database-empty"><div><Database size={21} /></div><strong>No database containers</strong><p>Create a database to connect your application.</p></div> : <div className="data-table database-table">{databases.map(database => <div className="data-row" key={database.name}><span className="file-name"><Database size={16} /><strong>{database.name}</strong></span><span className="muted-text">{database.container}</span><button className="row-more" onClick={() => { const oldPassword = window.prompt("Current database password"); const newPassword = window.prompt("New password (12+ characters)"); if (oldPassword && newPassword) rotate.mutate({ serverName, database: database.name, username, oldPassword, newPassword }); }} disabled={rotate.isPending}>Rotate</button><button className="row-more" onClick={() => { if (window.confirm("Delete database " + database.name + "?")) remove.mutate({ serverName, database: database.name }); }} disabled={remove.isPending}><Trash2 size={15} /></button></div>)}</div>}</div>;
}
function SchedulesView({ onAction, serverName }: { onAction: (action: string) => void; serverName: string }) {
  const utils = trpc.useUtils();
  const query = trpc.node.schedules.useQuery({ name: serverName });
  const [scheduleName, setScheduleName] = useState("");
  const [cron, setCron] = useState("*/5 * * * *");
  const [action, setAction] = useState<"start" | "stop" | "restart" | "command">("restart");
  const [payload, setPayload] = useState("");
  const create = trpc.node.createSchedule.useMutation({ onSuccess: () => { void utils.node.schedules.invalidate({ name: serverName }); setScheduleName(""); setPayload(""); onAction("Schedule created"); }, onError: e => onAction(e.message) });
  const toggle = trpc.node.toggleSchedule.useMutation({ onSuccess: () => { void utils.node.schedules.invalidate({ name: serverName }); onAction("Schedule updated"); }, onError: e => onAction(e.message) });
  const update = trpc.node.updateSchedule.useMutation({ onSuccess: () => { void utils.node.schedules.invalidate({ name: serverName }); onAction("Schedule updated"); }, onError: e => onAction(e.message) });
  const remove = trpc.node.deleteSchedule.useMutation({ onSuccess: () => { void utils.node.schedules.invalidate({ name: serverName }); onAction("Schedule deleted"); }, onError: e => onAction(e.message) });
  const run = trpc.node.runSchedule.useMutation({ onSuccess: () => onAction("Schedule executed"), onError: e => onAction(e.message) });
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!scheduleName || !/^(\S+\s+){4}\S+$/.test(cron.trim())) { onAction("Use a valid five-field cron expression"); return; } create.mutate({ name: serverName, scheduleName, cron: cron.trim(), action, payload: action === "command" ? payload : undefined }); };
  const schedules = query.data ?? [];
  return <div className="subview"><div className="subview-heading"><div><span className="eyebrow">Automated actions</span><h2>Schedules</h2><p>Run server actions automatically without keeping a browser open.</p></div></div><form className="settings-card schedule-create-form" onSubmit={submit}><div className="settings-card-head"><CalendarClock size={17} /><strong>Create schedule</strong></div><div className="schedule-form-grid"><label>Name<input value={scheduleName} onChange={event => setScheduleName(event.target.value)} placeholder="Nightly restart" required /></label><label>Cron<input value={cron} onChange={event => setCron(event.target.value)} placeholder="*/5 * * * *" required /><small>Minute hour day-of-month month day-of-week</small></label><label>Action<select value={action} onChange={event => setAction(event.target.value as typeof action)}><option value="start">Start</option><option value="stop">Stop</option><option value="restart">Restart</option><option value="command">Command</option></select></label>{action === "command" && <label>Command<input value={payload} onChange={event => setPayload(event.target.value)} placeholder="npm run cleanup" required /></label>}</div><button className="primary-button" type="submit" disabled={create.isPending}><Plus size={15} />{create.isPending ? "Creating…" : "Create schedule"}</button></form>{query.isLoading ? <div className="storage-loading"><RefreshCw size={17} className="spin-icon" />Loading schedules…</div> : schedules.length === 0 ? <div className="empty-state"><div><CalendarClock size={21} /></div><strong>No schedules configured</strong><p>Create a schedule to automate this server.</p></div> : <div className="schedule-list">{schedules.map(schedule => <div className="schedule-card" key={schedule.id}><div className="schedule-icon"><CalendarClock size={18} /></div><div className="schedule-main"><div className="schedule-title"><strong>{schedule.name}</strong><StatusPill tone={schedule.enabled ? "cyan" : "amber"}>{schedule.enabled ? "Active" : "Paused"}</StatusPill></div><code>{schedule.action === "command" ? schedule.payload : schedule.action} · {schedule.cron}</code><span>{schedule.lastRunAt ? "Last run " + new Date(schedule.lastRunAt).toLocaleString() : "Not run yet"}</span></div><div className="schedule-actions"><button className="icon-action" onClick={() => run.mutate({ name: serverName, scheduleId: schedule.id })} disabled={run.isPending} title="Run now"><Play size={15} /></button><button className="icon-action" onClick={() => { const nextName = window.prompt("Schedule name", schedule.name); const nextCron = window.prompt("Cron expression", schedule.cron); if (nextName && nextCron) update.mutate({ name: serverName, scheduleId: schedule.id, scheduleName: nextName, cron: nextCron, action: schedule.action, payload: schedule.payload || undefined }); }} disabled={update.isPending} title="Edit">Edit</button><button className="icon-action" onClick={() => toggle.mutate({ name: serverName, scheduleId: schedule.id, enabled: !schedule.enabled })} disabled={toggle.isPending}>{schedule.enabled ? <Pause size={15} /> : <Play size={15} />}</button><button className="icon-action" onClick={() => { if (window.confirm("Delete schedule " + schedule.name + "?")) remove.mutate({ name: serverName, scheduleId: schedule.id }); }} disabled={remove.isPending} title="Delete"><Trash2 size={15} /></button></div></div>)}</div>}</div>;
}
function UsersView({ onAction, serverName }: { onAction: (action: string) => void; serverName: string }) {
  const query = trpc.node.members.useQuery({ name: serverName });
  const members = query.data ?? [];
  return <div className="subview"><div className="subview-heading"><div><span className="eyebrow">Access control</span><h2>Users & permissions</h2><p>Live members and delegated permissions for this server.</p></div><button className="primary-button" onClick={() => onAction("Use the admin console to grant a new member access")}><UserPlus size={15} />Grant access</button></div>{query.isLoading ? <div className="storage-loading"><RefreshCw size={17} className="spin-icon" />Loading members…</div> : members.length === 0 ? <div className="empty-state"><div><Users size={21} /></div><strong>No delegated members</strong><p>The owner and administrators can access this server. Use the admin console to grant another user access.</p></div> : <div className="data-table user-table"><div className="data-row data-head"><span>User</span><span>Role</span><span>Permissions</span><span>Added</span><span /></div>{members.map(member => <div className="data-row" key={member.id}><span className="member"><span className="member-avatar">{(member.name || member.email || "U").slice(0, 2).toUpperCase()}</span><span><strong>{member.name || "Unnamed user"}</strong><small>{member.email || "No email"}</small></span></span><span className="role-chip">{member.role}</span><span className="permission-chips">{member.permissions.map(permission => <code key={permission}>{permission}</code>)}</span><span className="muted-text">{new Date(member.createdAt).toLocaleDateString()}</span><button className="row-more" onClick={() => onAction("Permission editing is available from the admin console")}><MoreHorizontal size={16} /></button></div>)}</div>}</div>;
}
function BackupsView({ onAction, serverName }: { onAction: (action: string) => void; serverName: string }) {
  const utils = trpc.useUtils();
  const query = trpc.node.backups.useQuery({ name: serverName });
  const create = trpc.node.createBackup.useMutation({ onSuccess: () => { void utils.node.backups.invalidate({ name: serverName }); onAction("Backup created"); }, onError: e => onAction(e.message) });
  const restore = trpc.node.restoreBackup.useMutation({ onSuccess: () => onAction("Backup restored"), onError: e => onAction(e.message) });
  const backups = query.data?.backups ?? [];
  return <div className="subview"><div className="subview-heading"><div><span className="eyebrow">Recovery points</span><h2>Backups</h2><p>Live snapshots from the Docker server volume.</p></div><button className="primary-button" onClick={() => create.mutate({ name: serverName })} disabled={create.isPending}><Plus size={15} />{create.isPending ? "Creating…" : "Create backup"}</button></div><div className="backup-banner"><div className="backup-banner-icon"><ShieldCheck size={19} /></div><div><strong>{query.isLoading ? "Loading backups…" : backups.length + " recovery point" + (backups.length === 1 ? "" : "s")}</strong><span>Backups are stored outside the live server volume.</span></div></div>{query.isLoading ? <div className="storage-loading"><RefreshCw size={17} className="spin-icon" />Loading backups…</div> : backups.length === 0 ? <div className="empty-state"><div><FileArchive size={21} /></div><strong>No backups yet</strong><p>Create a recovery point before making changes.</p></div> : <div className="data-table backup-table"><div className="data-row data-head"><span>Backup</span><span>Size</span><span>Created</span><span>Status</span><span /></div>{backups.map(backup => <div className="data-row" key={backup.name}><span className="backup-name"><FileArchive size={16} />{backup.name}</span><span className="muted-text">{formatBytes(backup.bytes)}</span><span className="muted-text">{new Date(backup.createdAt).toLocaleString()}</span><StatusPill>Ready</StatusPill><button className="row-more" onClick={() => restore.mutate({ name: serverName, backupName: backup.name })} disabled={restore.isPending}><RotateCcw size={15} /></button></div>)}</div>}</div>;
}
function StartupView({ onAction, serverName, startup, onSave, onSaveVariables }: { onAction: (action: string) => void; serverName: string; startup: string; onSave: (startup: string) => void; onSaveVariables: (variablesJson: string) => void }) {
  const [command, setCommand] = useState(startup);
  const [vars, setVars] = useState([{ key: "NODE_ENV", value: "production", secret: false }, { key: "DISCORD_TOKEN", value: "••••••••••••••••", secret: true }, { key: "LOG_LEVEL", value: "info", secret: false }, { key: "WEBHOOK_SECRET", value: "••••••••••••••••", secret: true }]);
  useEffect(() => setCommand(startup), [startup]);
  const addVariable = () => { const key = (window.prompt("Variable name", "NEW_VARIABLE") || "").trim().toUpperCase(); if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) { if (key) onAction("Variable names use letters, numbers, and underscores"); return; } const value = window.prompt("Variable value", "") ?? ""; const next = [...vars.filter((item) => item.key !== key), { key, value, secret: /TOKEN|SECRET|PASSWORD|KEY/i.test(key) }]; setVars(next); onSaveVariables(JSON.stringify(Object.fromEntries(next.map((item) => [item.key, item.value])))); };
  return <div className="subview"><div className="subview-heading"><div><span className="eyebrow">Runtime configuration</span><h2>Startup variables</h2><p>Variables are injected when the server starts. Secrets are encrypted at rest.</p></div><button className="primary-button" onClick={addVariable}><Plus size={15} />Add variable</button></div><div className="startup-card"><div className="startup-card-head"><div><strong>Runtime configuration</strong><span>Command: <code>{command}</code></span></div><button className="outline-button" onClick={() => { const next = window.prompt("Startup command", command); if (next !== null) { setCommand(next); onSave(next); } }}><Settings2 size={14} />Edit startup</button></div><div className="variable-table">{vars.map((variable) => <div className="variable-row" key={variable.key}><code>{variable.key}</code><span className={variable.secret ? "secret-value" : "variable-value"}>{variable.value}</span><button className="row-more" onClick={() => onAction(`${variable.key} copied`)}><Copy size={14} /></button><button className="row-more" onClick={() => onAction(`${variable.key} settings opened`)}><MoreHorizontal size={16} /></button></div>)}</div></div><div className="warning-note"><AlertTriangle size={16} /><div><strong>Changing startup settings restarts this server.</strong><span>Make sure your command and variables match your project before saving.</span></div></div></div>;
}

function NetworkView({ onAction, serverName }: { onAction: (action: string) => void; serverName: string }) {
  const query = trpc.node.network.useQuery({ name: serverName });
  const assigned = query.data?.assigned ?? []; const available = query.data?.available ?? [];
  const copy = (value: string) => { navigator.clipboard?.writeText(value); onAction("Allocation address copied"); };
  return <div className="subview"><div className="subview-heading"><div><span className="eyebrow">Public endpoints</span><h2>Network & allocations</h2><p>Live ports assigned to this server and available on its node.</p></div><button className="outline-button" onClick={() => query.refetch()}>Refresh</button></div>{query.isLoading ? <div className="storage-loading">Loading allocations…</div> : <><div className="network-grid">{assigned.length === 0 ? <div className="empty-state"><div><Network size={21} /></div><strong>No allocation assigned</strong><p>Ask an administrator to assign a network port to this server.</p></div> : assigned.map((allocation) => <div className="allocation-card allocation-primary" key={allocation.id}><div className="allocation-head"><div className="allocation-icon"><Network size={17} /></div><StatusPill>Assigned</StatusPill></div><strong>{allocation.ip}:{allocation.port}</strong><span>Public · TCP · IPv4{allocation.alias ? " · " + allocation.alias : ""}</span><div className="allocation-foot"><button onClick={() => copy(allocation.ip + ":" + allocation.port)}><Copy size={13} />Copy address</button></div></div>)}</div><div className="settings-card"><div className="settings-card-head"><Network size={17} /><strong>Available node allocations</strong></div>{available.length === 0 ? <p className="muted-text">No unassigned ports are available on this node.</p> : <div className="data-table">{available.slice(0, 40).map((allocation) => <div className="data-row" key={allocation.id}><span><strong>{allocation.ip}:{allocation.port}</strong></span><span className="muted-text">Available</span><span className="muted-text">{allocation.alias || "No alias"}</span></div>)}</div>}</div></>}</div>;
}
function GlobeIcon() { return <span className="domain-icon"><Network size={17} /></span>; }

function SettingsView({ onAction, serverName, onSave }: { onAction: (action: string) => void; serverName: string; onSave: (name: string) => void }) {
  const [name, setName] = useState(serverName);
  useEffect(() => setName(serverName), [serverName]);
  return <div className="subview"><div className="subview-heading"><div><span className="eyebrow">Server lifecycle</span><h2>Server settings</h2><p>Control the identity, power behavior, and destructive actions for this server.</p></div></div><div className="settings-grid"><div className="settings-card"><div className="settings-card-head"><Settings2 size={17} /><strong>General settings</strong></div><label>Server name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Description<textarea defaultValue="Realtime Discord intelligence and event processing." /></label><button className="primary-button" onClick={() => onSave(name)}><Check size={15} />Save changes</button></div><div className="settings-card"><div className="settings-card-head"><ShieldCheck size={17} /><strong>Power behavior</strong></div><div className="toggle-row"><span><strong>Auto-start on crash</strong><small>Restart after an unexpected exit.</small></span><button className="toggle toggle-on" onClick={() => onAction("Auto-start toggled")}><i /></button></div><div className="toggle-row"><span><strong>Announce maintenance</strong><small>Notify collaborators before a restart.</small></span><button className="toggle toggle-on" onClick={() => onAction("Maintenance alerts toggled")}><i /></button></div><div className="toggle-row"><span><strong>Install updates automatically</strong><small>Only patch-level runtime updates.</small></span><button className="toggle" onClick={() => onAction("Automatic updates toggled")}><i /></button></div></div></div><div className="danger-zone"><div><strong>Danger zone</strong><span>These actions affect production data and cannot be undone.</span></div><div><button onClick={() => onAction("Transfer server flow opened")}><ArrowDownToLine size={14} />Transfer server</button><button className="danger-button" onClick={() => onAction("Delete confirmation required")}><Trash2 size={14} />Delete server</button></div></div></div>;
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
  const serverInventory = trpc.servers.mine.useQuery(undefined, { enabled: Boolean(user) });
  const liveServers = (serverInventory.data ?? []).map(({ server, allocation, node }) => ({ name: server.name, label: `${server.runtime} · ${server.memoryMb} MiB · ${node?.name ?? "node"}${allocation ? ` · ${allocation.ip}:${allocation.port}` : ""}`, state: server.status === "running" ? "Running" : server.status === "installing" ? "Starting" : "Offline", tone: (server.status === "running" ? "cyan" : server.status === "failed" ? "red" : "amber") as Tone, icon: server.name.slice(0, 2).toUpperCase(), usage: 0 }));
  const visibleServers = liveServers.length ? liveServers : servers;
  const activeServerRecord = serverInventory.data?.find(({ server }) => server.name === activeServer.name);
  const [activeServer, setActiveServer] = useState(servers[0]);
  const [serverMenuOpen, setServerMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [serverRunning, setServerRunning] = useState(true);
  useEffect(() => { if (liveServers.length && !liveServers.some((server) => server.name === activeServer.name)) setActiveServer(liveServers[0]); }, [liveServers.length, activeServer.name]);
  const resourceStatsQuery = trpc.node.stats.useQuery({ name: activeServer.name }, { enabled: Boolean(activeServerRecord), refetchInterval: 5000 });
  const settingsMutation = trpc.node.updateSettings.useMutation({ onSuccess: () => toast("Server settings saved", { description: "The live server metadata was updated." }), onError: (error) => toast("Settings update failed", { description: error.message }) });
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

  const resourceStats = resourceStatsQuery.data as Record<string, unknown> | undefined;
  const cpuLive = typeof resourceStats?.CPUPerc === "string" ? resourceStats.CPUPerc : "—";
  const memoryLive = typeof resourceStats?.MemUsage === "string" ? resourceStats.MemUsage : "—";
  const networkLive = typeof resourceStats?.NetIO === "string" ? resourceStats.NetIO : "—";
  const diskLive = typeof resourceStats?.BlockIO === "string" ? resourceStats.BlockIO : "—";
  const grouped = useMemo(() => ({ Manage: navItems.filter((item) => item.group === "Manage"), Configure: navItems.filter((item) => item.group === "Configure") }), []);
  if (loading) return <div className="auth-screen"><div className="auth-card"><h1>Loading MYSTIC HOST…</h1></div></div>;
  if (!user) return <HomeLogin />;

  const action = (message: string) => toast(message, { description: "This control plane action is ready to connect to your runtime API." });
  const selectPanel = (panel: PanelKey) => { setActivePanel(panel); setSidebarOpen(false); };
  const powerAction = (next: "start" | "stop" | "restart") => {
    toast(`${next[0].toUpperCase()}${next.slice(1)}ing ${activeServer.name}…`, { description: "Calling the live Docker node." });
    nodeActionMutation.mutate({ name: activeServer.name, action: next });
  };

  const renderPanel = () => {
    const props = { onAction: action };
    if (activePanel === "Console") return <ConsoleView {...props} serverName={activeServer.name} onAction={(message) => { if (message.startsWith("Stopping")) setServerRunning(false); if (message.startsWith("Restarting")) setServerRunning(true); action(message); }} />;
    if (activePanel === "Files") return <FilesView {...props} serverName={activeServer.name} />;
    if (activePanel === "Databases") return <DatabasesView {...props} serverName={activeServer.name} />;
    if (activePanel === "Schedules") return <SchedulesView {...props} serverName={activeServer.name} />;
    if (activePanel === "Users") return <UsersView {...props} serverName={activeServer.name} />;
    if (activePanel === "Backups") return <BackupsView {...props} serverName={activeServer.name} />;
    if (activePanel === "Startup") return <StartupView {...props} serverName={activeServer.name} startup={activeServerRecord?.server.startup ?? "node server.js"} onSave={(startup) => settingsMutation.mutate({ name: activeServer.name, startup })} onSaveVariables={(variablesJson) => settingsMutation.mutate({ name: activeServer.name, variablesJson })} />;
    if (activePanel === "Network") return <NetworkView {...props} serverName={activeServer.name} />;
    if (activePanel === "Settings") return <SettingsView {...props} serverName={activeServer.name} onSave={(serverName) => settingsMutation.mutate({ name: activeServer.name, serverName })} />;
    return <ActivityView />;
  };

  return <div className="control-plane">
    <aside className={`panel-sidebar ${sidebarOpen ? "panel-sidebar-open" : ""}`}>
      <div className="sidebar-brand"><Logo /><div><strong>mystic-host<span>°</span></strong><small>control plane</small></div><button className="sidebar-close" onClick={() => setSidebarOpen(false)}><X size={17} /></button></div>
      <div className="account-switch"><span className="account-avatar">A</span><span><strong>Acme workspace</strong><small>Production account</small></span><ChevronDown size={14} /></div>
      <div className="server-switcher-wrap"><span className="sidebar-label">Your servers</span><button className="server-switcher" onClick={() => setServerMenuOpen(!serverMenuOpen)}><span className={`server-avatar server-avatar-${activeServer.tone}`}>{activeServer.icon}</span><span><strong>{activeServer.name}</strong><small><i className={`dot dot-${activeServer.tone}`} />{activeServer.state}</small></span><ChevronDown size={14} /></button>{serverMenuOpen && <div className="server-menu">{visibleServers.map((server) => <button key={server.name} onClick={() => { setActiveServer(server); setServerRunning(server.state === "Running"); setServerMenuOpen(false); action(`Switched to ${server.name}`); }}><span className={`server-avatar server-avatar-${server.tone}`}>{server.icon}</span><span><strong>{server.name}</strong><small>{server.label}</small></span>{server.name === activeServer.name && <Check size={14} />}</button>)}<div className="server-menu-foot"><Plus size={13} />Create new server</div></div>}</div>
      <nav className="panel-nav">{(["Manage", "Configure"] as const).map((group) => <div className="panel-nav-group" key={group}><span className="sidebar-label">{group}</span>{grouped[group].map(({ label, icon: Icon }) => <button key={label} className={`panel-nav-item ${activePanel === label ? "panel-nav-active" : ""}`} onClick={() => selectPanel(label)}><Icon size={16} /><span>{label}</span>{label === "Console" && <span className="nav-live" />}</button>)}</div>)}</nav>
      <div className="sidebar-bottom"><div className="node-health"><span className="health-icon"><Activity size={14} /></span><span><strong>Node healthy</strong><small>iad1 · 12ms latency</small></span><i /></div><div className="sidebar-links"><button onClick={() => { if (user?.role === "admin") window.location.href = "/admin"; else action("Admin access requires an administrator role"); }}><ShieldCheck size={15} />Admin console</button><button onClick={() => action("Support center opened")}><LifeBuoy size={15} />Support</button><button onClick={() => action("Documentation opened")}><CircleHelp size={15} />Docs</button></div><div className="signed-in"><span className="user-avatar">AM</span><span><strong>{user?.name ?? "Alex Morgan"}</strong><small>{user?.role === "admin" ? "Admin" : "Owner"}</small></span><button className="logout-button" onClick={logout} title="Log out">Log out</button></div></div>
    </aside>
    <main className="panel-main">
      <header className="panel-topbar"><button className="mobile-panel-menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><div className="panel-breadcrumb"><span>Servers</span><ChevronRight size={13} /><strong>{activeServer.name}</strong><ChevronRight size={13} /><span>{activePanel}</span></div><div className="topbar-right"><button className="global-search" onClick={() => setCommandOpen(true)}><Search size={15} /><span>Search anything</span><kbd>⌘ K</kbd></button><button className="topbar-icon" onClick={() => action("No new notifications")}><Bell size={17} /><i /></button><button className="topbar-help" onClick={() => action("Help center opened")}><CircleHelp size={16} /></button></div></header>
      <div className="panel-content">
        <section className="server-header"><div className="server-header-title"><div className={`large-server-icon server-avatar-${activeServer.tone}`}>{activeServer.icon}</div><div><div className="server-title-line"><h1>{activeServer.name}</h1><StatusPill tone={serverRunning ? "cyan" : "red"}>{serverRunning ? "Running" : "Offline"}</StatusPill></div><p>{activeServer.label} <span>·</span> {activeServerRecord?.server.runtime ?? "Node.js 22"} <span>·</span> {activeServerRecord?.node?.name ?? "iad1"}{activeServerRecord?.allocation ? ` · ${activeServerRecord.allocation.ip}:${activeServerRecord.allocation.port}` : ""}</p></div></div><div className="power-controls"><button className="power-button power-start" onClick={() => powerAction("start")} disabled={serverRunning || nodeActionMutation.isPending}><Play size={14} fill="currentColor" />Start</button><button className="power-button power-restart" onClick={() => powerAction("restart")} disabled={nodeActionMutation.isPending}><RotateCcw size={14} />Restart</button><button className="power-button power-stop" onClick={() => powerAction("stop")} disabled={!serverRunning || nodeActionMutation.isPending}><Square size={11} fill="currentColor" />Stop</button><button className="power-more" onClick={() => action("Power actions opened")}><MoreHorizontal size={17} /></button></div></section>
        <section className="resource-strip"><StatCard label="CPU usage" value={cpuLive} detail={`${activeServerRecord ? activeServerRecord.server.cpu / 100 : 2} vCPU allocated`} icon={Cpu} tone="cyan" /><StatCard label="Memory" value={memoryLive} detail={`${activeServerRecord ? activeServerRecord.server.memoryMb : 1024} MiB allocated`} icon={Activity} tone="violet" /><StatCard label="Storage I/O" value={diskLive} detail={`${activeServerRecord ? activeServerRecord.server.diskMb : 51200} MiB volume`} icon={HardDrive} tone="lime" /><StatCard label="Network I/O" value={networkLive} detail={`${activeServerRecord?.node?.name ?? "node"} live traffic`} icon={Wifi} tone="amber" /><div className="resource-graph"><div className="resource-graph-head"><span>Resource usage</span><span className="graph-live"><i />Live</span></div><svg viewBox="0 0 190 48" preserveAspectRatio="none"><defs><linearGradient id="fill-cyan" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#6bf6d2" stopOpacity=".28" /><stop offset="1" stopColor="#6bf6d2" stopOpacity="0" /></linearGradient></defs><path d="M0 40 C12 36 16 38 25 31 S42 33 50 27 S66 31 76 20 S92 25 102 19 S121 24 129 13 S144 20 153 14 S167 18 190 5 L190 48 L0 48Z" fill="url(#fill-cyan)" /><path d="M0 40 C12 36 16 38 25 31 S42 33 50 27 S66 31 76 20 S92 25 102 19 S121 24 129 13 S144 20 153 14 S167 18 190 5" fill="none" stroke="#6bf6d2" strokeWidth="1.5" /></svg></div></section>
        <div className="panel-view-heading"><div><span className="view-eyebrow">{activePanel === "Console" ? "Live process" : "Server workspace"}</span><h2>{activePanel}</h2></div><div className="view-heading-actions">{activePanel === "Console" ? <><span className="last-deploy"><Check size={13} /> Deployed 12 min ago</span><button className="outline-button" onClick={() => action("Deployment details opened")}><Box size={14} />Deployment</button></> : <span className="server-id">Server ID <code>{activeServerRecord?.server.identifier ?? "pending"}</code><Copy size={13} /></span>}</div></div>
        {renderPanel()}
      </div>
      <footer className="panel-footer"><span><i className="footer-dot" />All systems operational</span><span>API v1 · mystic-host° control plane</span><span>Region iad1 <span className="footer-separator">·</span> v1.8.0</span></footer>
    </main>
    {commandOpen && <div className="command-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommandOpen(false); }}><div className="command-panel"><div className="command-input"><Search size={17} /><input autoFocus placeholder="Search servers, files, settings..." /><kbd>esc</kbd></div><div className="command-list"><span>Quick navigation</span>{navItems.slice(0, 6).map(({ label, icon: Icon }) => <button key={label} onClick={() => { selectPanel(label); setCommandOpen(false); }}><Icon size={16} /><strong>{label}</strong><small>Open server {label.toLowerCase()}</small><kbd>↵</kbd></button>)}</div><div className="command-foot"><span><kbd>↑↓</kbd> navigate</span><span><kbd>↵</kbd> select</span><span><kbd>esc</kbd> close</span></div></div></div>}
  </div>;
}
