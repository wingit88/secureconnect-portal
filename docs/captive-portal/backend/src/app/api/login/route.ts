import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalize } from "@/lib/mac";
import { loginSchema } from "@/lib/validators";
import { take } from "@/lib/rateLimit";
import {
  approveDevice,
} from "@/lib/mikrotik";
import { refreshDeviceHostname } from "@/lib/device-sync";
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

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#0f172a}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;max-width:480px;width:90%;text-align:center;box-shadow:0 10px 30px -10px rgba(0,0,0,.1)}
h1{font-size:20px;margin:0 0 12px}p{color:#475569;line-height:1.5;margin:0}</style></head>
<body><div class="card"><h1>${title}</h1><div>${body}</div></div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function alreadyApprovedPage(target: string): Response {
  const safeTarget = resolveContinueUrl(target);
  return page(
    "Device already approved",
    `<p>You can access internet now.</p>
     <p style="margin-top:12px"><a href="${esc(safeTarget)}" style="color:#0f172a;font-weight:600;text-decoration:underline">Continue</a></p>
     <script>setTimeout(function(){ window.location.href = ${JSON.stringify(safeTarget)}; }, 1500);</script>`,
  );
}

function reasonForm(
  studentId: string,
  nama: string,
  kelas: string,
  mac: string,
  ip: string,
  target: string,
  portalBase: string,
): Response {
  const loginUrl = `${portalBase}/api/login`;
  return page(
    "Additional device request",
    `<p style="margin-bottom:16px">You already have a registered device. Tell the admin why you need to add this one.</p>
     <form method="POST" action="${esc(loginUrl)}" style="text-align:left">
       <input type="hidden" name="studentId" value="${esc(studentId)}">
       <input type="hidden" name="nama" value="${esc(nama)}">
       <input type="hidden" name="kelas" value="${esc(kelas)}">
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
  const portalBase = portalPublicBase(req);
  const raw = await parseBody(req);
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return page("Invalid request", parsed.error.issues[0]?.message ?? "Bad input", 400);

  const { studentId, nama, kelas, ip, target, reason } = parsed.data;
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
      data: { studentId, nama, kelas, status: "PENDING" },
    });
    const device = await db.device.upsert({
      where: { macAddress: mac },
      update: { studentId: created.id, approved: false, reason: "first-registration" },
      create: { macAddress: mac, studentId: created.id, approved: false, reason: "first-registration" },
    });
    void refreshDeviceHostname(mac, device.id).catch(() => {});
    const waitHtml = buildWaitingPage({ studentId, nama, kelas, mac, ip, target: target ?? "", portalBase });
    return new Response(waitHtml, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

  }

  const currentDevice = student.devices.find((d) => d.macAddress === mac) ?? null;

  // 2) Denied or revoked
  if (shouldBlockPortalAccess(student.status, currentDevice)) {
    return NextResponse.redirect(portalUrl("/api/denied", req));
  }

  // 3) Pending — keep polling so the page updates when admin approves
  if (student.status === "PENDING") {
    const waitHtml = buildWaitingPage({
      studentId,
      nama: student.nama.length >= 2 ? student.nama : nama,
      kelas: student.kelas.length >= 1 ? student.kelas : kelas,
      mac,
      ip,
      target: target ?? "",
      portalBase,
    });
    return new Response(waitHtml, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  // 4) ACTIVE
  const existingForMac = student.devices.find((d) => d.macAddress === mac);
  const successUrl = resolveContinueUrl(target ?? "");
  const approvedDeviceCount = student.devices.filter((d) => d.approved).length;

  // 4a) This MAC already approved -> refresh router auth and show success page
  if (existingForMac && existingForMac.approved) {
    return alreadyApprovedPage(successUrl);
  }

  // 4b) Existing pending row for this MAC -> avoid asking for the reason again.
  if (existingForMac && !existingForMac.approved) {
    return page(
      "Request already submitted",
      "<p>This device is still waiting for administrator approval.</p>",
    );
  }

  // 4c) No approved device yet -> auto-approve this as first usable device
  if (approvedDeviceCount === 0) {
    await db.device.upsert({
      where: { macAddress: mac },
      update: { studentId: student.id, approved: true, reason: null },
      create: { macAddress: mac, studentId: student.id, approved: true },
    });
    try {
      await approveDevice(studentId, mac, ip);
    } catch (err) {
      console.error("mikrotik hotspot-user sync failed", err);
      // roll back so admin can retry approval
      await db.device.update({ where: { macAddress: mac }, data: { approved: false, reason: "router-bind-failed" } });
      return page("Network busy", "<p>Couldn't reach the network controller. Please try again in a minute.</p>", 503);
    }
    return alreadyApprovedPage(successUrl);
  }

  // 4d) Student already has approved device(s) -> require reason for additional device
  const normalizedReason = reason?.trim() ?? "";
  if (normalizedReason.length < 5) {
    return reasonForm(studentId, student.nama, student.kelas, mac, ip, target ?? "", portalBase);
  }

  await db.device.upsert({
    where: { macAddress: mac },
    update: { studentId: student.id, approved: false, reason: normalizedReason },
    create: { macAddress: mac, studentId: student.id, approved: false, reason: normalizedReason },
  });
  void refreshDeviceHostname(mac).catch(() => {});
  return page(
    "Request submitted",
    "<p>Your request to add this device has been sent to the administrator.</p>",
  );
}