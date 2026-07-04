import { NextRequest } from "next/server";
import { safeNormalize } from "@/lib/mac";
import { db } from "@/lib/db";

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

  if (mac) {
    const device = await db.device.findUnique({
      where: { macAddress: mac },
      include: { student: { select: { status: true } } },
    }).catch(() => null);

    if (device?.approved && device.student?.status === "ACTIVE") {
      const continueUrl = /^https?:\/\//i.test(target)
        ? target
        : (process.env.HOTSPOT_GATEWAY_URL ?? "http://192.168.30.1/status");

      // Must be plain http:// and NOT whitelisted in the hotspot walled garden,
      // otherwise the probe always "succeeds" without ever touching mac-auth.
      const probeUrl = process.env.HOTSPOT_PROBE_URL ?? "http://neverssl.com/favicon.ico";

      const approvedHtml = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Perangkat Sudah Disetujui</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;max-width:460px;width:90%;box-shadow:0 10px 30px -10px rgba(0,0,0,.1);text-align:center}
    h1{margin:0 0 8px;font-size:22px}
    p{color:#475569;margin:0 0 14px;line-height:1.5}
    .status{font-size:13px;color:#94a3b8;margin-top:10px}
    a{display:inline-block;margin-top:4px;color:#0f172a;font-weight:600}
  </style>
</head>
<body>
  <div class="card">
    <h1>Perangkat sudah disetujui</h1>
    <p id="msg">Menghubungkan ke internet...</p>
    <div class="status" id="status">Memeriksa koneksi (percobaan <span id="n">1</span>)</div>
    <a href="${esc(continueUrl)}" id="manualLink" style="display:none">Lanjutkan manual</a>
  </div>
  <script>
    (function () {
      var continueUrl = ${JSON.stringify(continueUrl)};
      var probeBase = ${JSON.stringify(probeUrl)};
      var attempts = 0;
      var maxAttempts = 20;      // ~20s worth of retries
      var intervalMs = 1000;

      function goOnline() {
        document.getElementById("msg").textContent = "Terhubung! Mengalihkan...";
        window.location.href = continueUrl;
      }

      function showManualFallback() {
        document.getElementById("msg").textContent =
          "Belum bisa terhubung otomatis.";
        document.getElementById("manualLink").style.display = "inline-block";
      }

      function probe() {
        attempts++;
        var n = document.getElementById("n");
        if (n) n.textContent = String(attempts);

        var img = new Image();
        var settled = false;

        var timeout = setTimeout(function () {
          if (settled) return;
          settled = true;
          onFail();
        }, 3000);

        img.onload = function () {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          goOnline();
        };

        img.onerror = function () {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          onFail();
        };

        // cache-bust so we never read a cached success/failure
        img.src = probeBase + (probeBase.indexOf("?") >= 0 ? "&" : "?") + "cb=" + Date.now();
      }

      function onFail() {
        if (attempts < maxAttempts) {
          setTimeout(probe, intervalMs);
        } else {
          showManualFallback();
        }
      }

      setTimeout(probe, 600);
    })();
  </script>
</body>
</html>`;

      return new Response(approvedHtml, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
  }

  const html = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Login Jaringan Siswa</title>
  <style>
    body{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;max-width:420px;width:90%;box-shadow:0 10px 30px -10px rgba(0,0,0,.1)}
    h1{margin:0 0 8px;font-size:20px}
    p{color:#475569;margin:0 0 20px;font-size:14px}
    label{display:block;font-size:13px;margin-bottom:6px;color:#334155}
    input[type=text]{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:15px;box-sizing:border-box;margin-bottom:12px}
    button{margin-top:4px;width:100%;background:#0f172a;color:#fff;border:0;border-radius:8px;padding:12px;font-size:15px;cursor:pointer}
    button:hover{background:#1e293b}
    .meta{font-size:11px;color:#94a3b8;margin-top:16px;text-align:center}
  </style>
</head>
<body>
  <form class="card" method="POST" action="/api/login" autocomplete="off">
    <h1>Login Jaringan Sekolah</h1>
    <p>Isi data berikut untuk mengakses internet.</p>
    <label for="studentId">NIS / Student ID</label>
    <input id="studentId" name="studentId" type="text" required autofocus pattern="[A-Za-z0-9_-]+" maxlength="64">
    <label for="nama">Nama lengkap</label>
    <input id="nama" name="nama" type="text" required minlength="2" maxlength="100">
    <label for="kelas">Kelas</label>
    <input id="kelas" name="kelas" type="text" required minlength="1" maxlength="50" placeholder="Contoh: X IPA 1">
    <input type="hidden" name="mac" value="${esc(mac)}">
    <input type="hidden" name="ip" value="${esc(ip)}">
    <input type="hidden" name="target" value="${esc(target)}">
    <button type="submit">Daftar / Connect</button>
    <div class="meta">Perangkat: ${esc(mac || "unknown")} · ${esc(ip || "unknown")}</div>
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