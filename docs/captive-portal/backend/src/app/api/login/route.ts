import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalize } from "@/lib/mac";
import { loginSchema } from "@/lib/validators";
import { take } from "@/lib/rateLimit";
import {
  approveDevice,
} from "@/lib/mikrotik";

export const dynamic = "force-dynamic";

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#0f172a}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;max-width:480px;width:90%;text-align:center;box-shadow:0 10px 30px -10px rgba(0,0,0,.1)}
h1{font-size:20px;margin:0 0 12px}p{color:#475569;line-height:1.5;margin:0}</style></head>
<body><div class="card"><h1>${title}</h1><div>${body}</div></div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function reasonForm(studentId: string, mac: string, ip: string, target: string): Response {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return page(
    "Additional device request",
    `<p style="margin-bottom:16px">You already have a registered device. Tell the admin why you need to add this one.</p>
     <form method="POST" action="/api/login" style="text-align:left">
       <input type="hidden" name="studentId" value="${esc(studentId)}">
       <input type="hidden" name="mac" value="${esc(mac)}">
       <input type="hidden" name="ip" value="${esc(ip)}">
       <input type="hidden" name="target" value="${esc(target)}">
       <label for="reason" style="display:block;font-size:13px;margin-bottom:6px;color:#334155">Reason</label>
       <textarea id="reason" name="reason" required minlength="5" maxlength="500" rows="4"
         style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-family:inherit;font-size:14px;box-sizing:border-box"></textarea>
       <button type="submit" style="margin-top:16px;width:100%;background:#0f172a;color:#fff;border:0;border-radius:8px;padding:12px;font-size:15px;cursor:pointer">
         Submit request
       </button>
     </form>`,
  );
}

async function parseBody(req: NextRequest): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await req.json()) as Record<string, string>;
  const form = await req.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") out[k] = v;
  return out;
}

export async function POST(req: NextRequest) {
  const raw = await parseBody(req);
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return page("Invalid request", parsed.error.issues[0]?.message ?? "Bad input", 400);

  const { studentId, ip, target, reason } = parsed.data;
  let mac: string;
  try { mac = normalize(parsed.data.mac); }
  catch { return page("Invalid request", "Bad MAC address", 400); }

  if (!take(`login:${mac}`, 8, 0.2)) return page("Slow down", "Too many attempts. Try again shortly.", 429);

  const student = await db.student.findUnique({
    where: { studentId },
    include: { devices: true },
  });

  // 1) Unknown student -> create PENDING + record device unapproved
  if (!student) {
    const created = await db.student.create({
      data: { studentId, status: "PENDING" },
    });
    await db.device.upsert({
      where: { macAddress: mac },
      update: { studentId: created.id, approved: false, reason: "first-registration" },
      create: { macAddress: mac, studentId: created.id, approved: false, reason: "first-registration" },
    });
    // Show a waiting page that polls /api/status and auto-submits the login
    // form once the admin approves. Path 4a then creates/refreshes the IP
    // binding and evicts the walled-off hotspot host entry.
    const waitHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Waiting for approval…</title>
<style>
body{font-family:system-ui,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#0f172a}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;max-width:480px;width:90%;text-align:center;box-shadow:0 10px 30px -10px rgba(0,0,0,.1)}
h1{font-size:20px;margin:0 0 12px}p{color:#475569;line-height:1.5;margin:0 0 12px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#94a3b8;margin:0 3px;animation:pulse 1.4s ease-in-out infinite}
.dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
@keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
</style></head>
<body><div class="card">
<h1>Registration submitted</h1>
<p>Your registration is awaiting administrator approval.</p>
<p>This page will automatically connect you once approved.</p>
<p style="margin-top:16px"><span class="dot"></span><span class="dot"></span><span class="dot"></span></p>
<form id="f" method="POST" action="/api/login" style="display:none">
  <input name="studentId" value="${studentId}">
  <input name="mac" value="${mac}">
  <input name="ip" value="${ip}">
  <input name="target" value="${target ?? ""}">
</form>
<script>
(function(){
  var mac=encodeURIComponent("${mac}");
  function check(){
    fetch("/api/status?mac="+mac,{cache:"no-store"})
      .then(function(r){return r.json();})
      .then(function(d){
        if(d.approved){document.getElementById("f").submit();return;}
        if(d.studentStatus==="DENIED"){window.location.href="/api/denied";return;}
        setTimeout(check,4000);
      })
      .catch(function(){setTimeout(check,6000);});
  }
  setTimeout(check,4000);
})();
</script>
</div></body></html>`;
    return new Response(waitHtml, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

  }

  // 2) Denied
  if (student.status === "DENIED") {
    return NextResponse.redirect(new URL("/api/denied", req.url));
  }

  // 3) Pending
  if (student.status === "PENDING") {
    return page("Awaiting approval", "<p>Your registration is still awaiting administrator approval.</p>");
  }

  // 4) ACTIVE
  const existingForMac = student.devices.find((d) => d.macAddress === mac);
  const successUrl = target && /^https?:\/\//i.test(target) ? target : (process.env.HOTSPOT_GATEWAY_URL ?? "http://192.168.30.1/status");

  // 4a) This MAC already bound & approved -> refresh IP binding, bypass hotspot
  if (existingForMac && existingForMac.approved) {
    try { await approveDevice(studentId, mac); }
    catch (err) { console.error("ip-binding refresh failed", err); }
    return NextResponse.redirect(successUrl, { status: 302 });
  }

  // 4b) No devices bound yet -> bind this MAC with a bypassed IP binding
  if (student.devices.length === 0) {
    await db.device.upsert({
      where: { macAddress: mac },
      update: { studentId: student.id, approved: true, reason: null },
      create: { macAddress: mac, studentId: student.id, approved: true },
    });
    try {
      await approveDevice(studentId, mac);
    } catch (err) {
      console.error("mikrotik bind failed", err);
      // roll back so admin can retry approval
      await db.device.update({ where: { macAddress: mac }, data: { approved: false, reason: "router-bind-failed" } });
      return page("Network busy", "<p>Couldn't reach the network controller. Please try again in a minute.</p>", 503);
    }
    return NextResponse.redirect(successUrl, { status: 302 });
  }

  // 4c) Different MAC already bound -> require reason, create pending request
  if (!reason) return reasonForm(studentId, mac, ip, target ?? "");

  await db.device.upsert({
    where: { macAddress: mac },
    update: { studentId: student.id, approved: false, reason },
    create: { macAddress: mac, studentId: student.id, approved: false, reason },
  });
  return page(
    "Request submitted",
    "<p>Your request to add this device has been sent to the administrator.</p>",
  );
}