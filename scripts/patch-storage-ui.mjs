import fs from "node:fs";

const path = "/opt/mystic-host/client/src/pages/Home.tsx";
let source = fs.readFileSync(path, "utf8");
source = source.replace(
  'import { useEffect, useMemo, useState } from "react";',
  'import { useEffect, useMemo, useRef, useState } from "react";\nimport { useAuth } from "@/_core/hooks/useAuth";\nimport { trpc } from "@/lib/trpc";'
);

const filesView = String.raw`function formatBytes(bytes: number) {
  if (bytes < 1024) return String(bytes) + " B";
  if (bytes < 1024 * 1024) return String((bytes / 1024).toFixed(1)) + " KB";
  return String((bytes / (1024 * 1024)).toFixed(1)) + " MB";
}

function FilesView({ onAction, serverName }: { onAction: (action: string) => void; serverName: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const filesQuery = trpc.files.list.useQuery({ serverName });
  const uploadMutation = trpc.files.upload.useMutation({
    onSuccess: () => {
      void utils.files.list.invalidate({ serverName });
      onAction("File uploaded to storage");
    },
    onError: (error) => onAction(error.message),
  });
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
  return <div className="subview"><div className="subview-toolbar"><div className="pathbar"><ChevronLeft size={15} /><span>/</span><strong>home</strong><span>/</span><strong>container</strong></div><div className="toolbar-actions"><input ref={fileInput} type="file" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadFile(file); event.currentTarget.value = ""; }} /><button className="outline-button" onClick={() => fileInput.current?.click()} disabled={uploadMutation.isPending}><Upload size={14} />{uploadMutation.isPending ? "Uploading..." : "Upload"}</button><button className="outline-button" onClick={() => onAction("New folder flow opened")}><Plus size={14} />New folder</button><button className="icon-action" onClick={() => onAction("More file actions opened")}><MoreHorizontal size={17} /></button></div></div><div className="file-tools"><div className="file-search"><Search size={14} /><input placeholder="Filter files..." /></div><span>{filesQuery.isLoading ? "Loading storage..." : String(rows.length) + " items · secure object storage"}</span></div>{filesQuery.isLoading ? <div className="storage-loading"><RefreshCw size={17} className="spin-icon" />Loading files from storage...</div> : rows.length === 0 ? <div className="empty-state storage-empty"><div><Folder size={21} /></div><strong>No uploaded files yet</strong><p>Upload a project file to store it securely for this server.</p><button onClick={() => fileInput.current?.click()}>Upload first file <Upload size={14} /></button></div> : <div className="data-table file-table"><div className="data-row data-head"><span><input type="checkbox" aria-label="Select all files" /></span><span>Name</span><span>Size</span><span>Uploaded</span><span /></div>{rows.map((file) => <div className="data-row" key={file.id}><span><input type="checkbox" aria-label={"Select " + file.originalName} /></span><span className="file-name"><span className="file-icon file-icon-code"><File size={16} /></span><strong>{file.originalName}</strong></span><span className="muted-text">{formatBytes(file.size)}</span><span className="muted-text">{new Date(file.createdAt).toLocaleString()}</span><button className="row-more" onClick={() => { if (window.confirm("Remove " + file.originalName + " from this server?")) deleteMutation.mutate({ id: file.id }); }} disabled={deleteMutation.isPending}><Trash2 size={15} /></button></div>)}</div>}<div className="file-tip"><ShieldCheck size={15} /><span>Files are stored in secure object storage. Up to 10 MB per upload.</span><button onClick={() => onAction("File editor opened")}>Open editor <ChevronRight size={14} /></button></div></div>;
}

function DatabasesView`;

source = source.replace(/function FilesView[\s\S]*?function DatabasesView/, filesView);
source = source.replace('if (activePanel === "Files") return <FilesView {...props} />;', 'if (activePanel === "Files") return <FilesView {...props} serverName={activeServer.name} />;');
source = source.replace(/  \/\/ The useAuth hook provides authentication state\.[\s\S]*?  let \{ user, loading, error, isAuthenticated, logout \} = useAuth\(\);\n/, '  const { user } = useAuth();\n');
source = source.replace('<strong>Alex Morgan</strong><small>Owner</small>', '<strong>{user?.name ?? "Alex Morgan"}</strong><small>{user?.role === "admin" ? "Admin" : "Owner"}</small>');
fs.writeFileSync(path, source);
