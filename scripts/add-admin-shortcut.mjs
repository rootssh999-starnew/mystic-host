import fs from "node:fs";
const path = "/opt/mystic-host/client/src/pages/Home.tsx";
let source = fs.readFileSync(path, "utf8");
const marker = '<div className="sidebar-links">';
const shortcut = '<button onClick={() => { if (user?.role === "admin") window.location.href = "/admin"; else action("Admin access requires an administrator role"); }}><ShieldCheck size={15} />Admin console</button>';
if (!source.includes(shortcut)) source = source.replace(marker, marker + shortcut);
fs.writeFileSync(path, source);
