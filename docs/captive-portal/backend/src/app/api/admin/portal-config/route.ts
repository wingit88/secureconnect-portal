import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { setPortalConfig } from "@/lib/portalConfig";

const schema = z.object({
  urlFilterMode: z.enum(["disabled", "blacklist", "whitelist"]).optional(),
  urlBlacklist: z.string().optional(),
  urlWhitelist: z.string().optional(),
});

function parseLines(input?: string) {
  if (!input) return undefined;
  return input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export async function POST(req: NextRequest) {
  await requireAdmin();

  let body: Record<string, any> | null = null;
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    body = await req.json().catch(() => null);
  } else {
    const form = await req.formData().catch(() => null);
    if (form) {
      body = {};
      for (const [k, v] of form.entries()) {
        body[k] = typeof v === "string" ? v : String(v);
      }
    }
  }

  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return new NextResponse("Invalid input", { status: 400 });

  try {
    await setPortalConfig({
      urlFilterMode: parsed.data.urlFilterMode,
      urlBlacklist: parseLines(parsed.data.urlBlacklist),
      urlWhitelist: parseLines(parsed.data.urlWhitelist),
    });
  } catch (err: any) {
    console.error("failed to save portal config", err);
    return new NextResponse("Failed to save settings. Ensure database migrations have been applied.", { status: 500 });
  }

  return NextResponse.redirect(new URL("/admin/settings", req.url));
}
