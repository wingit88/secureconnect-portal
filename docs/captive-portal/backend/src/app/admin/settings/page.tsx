import { getPortalConfig, setPortalConfig } from "@/lib/portalConfig";
import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { syncUrlFilter } from "@/lib/mikrotik";
import { z } from "zod";

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

export default async function SettingsPage() {
  await requireAdmin();
  const config = await getPortalConfig();

  async function handleSubmit(formData: FormData) {
    "use server";
    const data = {
      urlFilterMode: formData.get("urlFilterMode") as string | undefined,
      urlBlacklist: formData.get("urlBlacklist") as string | undefined,
      urlWhitelist: formData.get("urlWhitelist") as string | undefined,
    };

    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new Error("Invalid input");

    try {
      const mode = parsed.data.urlFilterMode ?? "disabled";
      await setPortalConfig({
        urlFilterMode: mode,
        urlBlacklist: parseLines(parsed.data.urlBlacklist),
        urlWhitelist: parseLines(parsed.data.urlWhitelist),
      });
      await syncUrlFilter({
        urlFilterMode: mode,
        urlBlacklist: parseLines(parsed.data.urlBlacklist) ?? [],
        urlWhitelist: parseLines(parsed.data.urlWhitelist) ?? [],
      });
    } catch (err) {
      console.error("failed to save portal config", err);
      throw new Error("Failed to save settings");
    }

    redirect("/admin/settings");
  }

  const join = (arr: string[]) => arr.join("\n");

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Portal Settings</h1>

      <form action={handleSubmit} className="space-y-6">
        <div>
          <label className="block font-medium">URL filter mode</label>
          <div className="mt-2 space-x-4">
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="urlFilterMode" value="disabled" defaultChecked={config.urlFilterMode === "disabled"} />
              <span>Disabled</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="urlFilterMode" value="blacklist" defaultChecked={config.urlFilterMode === "blacklist"} />
              <span>Blacklist</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="urlFilterMode" value="whitelist" defaultChecked={config.urlFilterMode === "whitelist"} />
              <span>Whitelist</span>
            </label>
          </div>
        </div>

        <div>
          <label className="block font-medium">URL Blacklist (one entry per line)</label>
          <textarea name="urlBlacklist" rows={6} className="w-full mt-2 p-2 border rounded" defaultValue={join(config.urlBlacklist)} />
        </div>

        <div>
          <label className="block font-medium">URL Whitelist (one entry per line)</label>
          <textarea name="urlWhitelist" rows={6} className="w-full mt-2 p-2 border rounded" defaultValue={join(config.urlWhitelist)} />
        </div>

        <div>
          <button type="submit" className="px-4 py-2 bg-slate-800 text-white rounded">Save settings</button>
        </div>
      </form>
    </div>
  );
}
