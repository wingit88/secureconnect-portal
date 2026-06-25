import { getPortalConfig } from "@/lib/portalConfig";
import { requireAdmin } from "@/lib/auth";

export default async function SettingsPage() {
  await requireAdmin();
  const config = await getPortalConfig();

  const join = (arr: string[]) => arr.join("\n");

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Portal Settings</h1>

      <form method="post" action="/api/admin/portal-config" className="space-y-6">
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
