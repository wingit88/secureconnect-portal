import { NextRequest, NextResponse } from "next/server";
import { safeNormalize } from "@/lib/mac";
import { db } from "@/lib/db";
import { buildWaitingPage } from "@/lib/wait-page";
import { resolveContinueUrl } from "@/lib/hotspot";
import { portalPublicBase, portalUrl } from "@/lib/portal-url";
import { shouldBlockPortalAccess } from "@/lib/access-policy";

export const dynamic = "force-dynamic";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function buildApprovedPage(continueUrl: string): string {
  const probeUrl = process.env.HOTSPOT_PROBE_URL ?? "http://neverssl.com/favicon.ico";

  return `<!doctype html>
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
      var maxAttempts = 20;
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
}

function buildLoginPage(mac: string, ip: string, target: string, portalBase: string): string {
  const loginUrl = `${portalBase}/api/login`;
  return `<!doctype html>
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
  <form class="card" method="POST" action="${esc(loginUrl)}" autocomplete="off">
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
}

export async function GET(req: NextRequest) {
  const u = req.nextUrl;
  const mac = safeNormalize(u.searchParams.get("mac")) ?? "";
  const ip = u.searchParams.get("ip") ?? "";
  const target = u.searchParams.get("target") ?? "";
  const portalBase = portalPublicBase(req);

  if (mac) {
    const device = await db.device.findUnique({
      where: { macAddress: mac },
      include: {
        student: { select: { status: true, studentId: true, nama: true, kelas: true } },
      },
    }).catch(() => null);

    if (device?.student) {
      const { student } = device;

      const currentDevice = device;
      if (shouldBlockPortalAccess(student.status, currentDevice)) {
        return NextResponse.redirect(portalUrl("/api/denied", req));
      }

      if (device.approved && student.status === "ACTIVE") {
        return htmlResponse(buildApprovedPage(resolveContinueUrl(target)));
      }

      if (student.status === "PENDING" || !device.approved) {
        return htmlResponse(
          buildWaitingPage({
            studentId: student.studentId,
            nama: student.nama,
            kelas: student.kelas,
            mac,
            ip,
            target,
            portalBase,
          }),
        );
      }
    }
  }

  return htmlResponse(buildLoginPage(mac, ip, target, portalBase));
}