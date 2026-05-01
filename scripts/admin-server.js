// scripts/admin-server.js — kibarometer admin
// Phase 1 stub: just /admin/health. The full server (auth + sections + sbFetch)
// lands in Phase 3. This stub exists so local-dev/setup.sh has something to
// bind-mount and verify against.
import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 4000);

const server = createServer((req, res) => {
  if (req.url === "/admin/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, phase: 1 }));
  }
  res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("kibarometer admin: Phase 1 stub. Login arrives in Phase 3.\n");
});

server.listen(PORT, () => console.log(`admin (Phase 1 stub) listening on :${PORT}`));
