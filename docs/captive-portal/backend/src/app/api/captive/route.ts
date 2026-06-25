import { NextRequest } from "next/server";
import { safeNormalize } from "@/lib/mac";

export const dynamic = "force-dynamic";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export async function GET(req: NextRequest) {
  const u = req.nextUrl;
  const mac = safeNormalize(u.searchParams.get("mac")) ?? "";
  const ip = u.searchParams.get("ip") ?? "";
  const target = u.searchParams.get("target") ?? "";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Student Network Login</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;max-width:420px;width:90%;box-shadow:0 10px 30px -10px rgba(0,0,0,.1)}
    h1{margin:0 0 8px;font-size:20px}
    p{color:#475569;margin:0 0 20px;font-size:14px}
    label{display:block;font-size:13px;margin-bottom:6px;color:#334155}
    input[type=text],textarea{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:15px;box-sizing:border-box}
    button{margin-top:16px;width:100%;background:#0f172a;color:#fff;border:0;border-radius:8px;padding:12px;font-size:15px;cursor:pointer}
    button:hover{background:#1e293b}
    .meta{font-size:11px;color:#94a3b8;margin-top:16px;text-align:center}
  </style>
</head>
<body>
  <form class="card" method="POST" action="/api/login" autocomplete="off">
    <h1>School Network Login</h1>
    <p>Enter your Student ID to access the internet.</p>
    <label for="studentId">Student ID</label>
    <input id="studentId" name="studentId" type="text" required autofocus pattern="[A-Za-z0-9_-]+" maxlength="64">
    <label for="nama">Nama</label>
    <input id="nama" name="nama" type="text" maxlength="128">
    <label for="kelas">Kelas</label>
    <input id="kelas" name="kelas" type="text" maxlength="64">
    <input type="hidden" name="mac" value="${esc(mac)}">
    <input type="hidden" name="ip" value="${esc(ip)}">
    <input type="hidden" name="target" value="${esc(target)}">
    <button type="submit">Connect</button>
    <div class="meta">Device: ${esc(mac || "unknown")} · ${esc(ip || "unknown")}</div>
  </form>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}