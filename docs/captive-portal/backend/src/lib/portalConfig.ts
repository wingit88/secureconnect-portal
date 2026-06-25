import { db } from "@/lib/db";

type UrlFilterMode = "disabled" | "blacklist" | "whitelist";

type PortalConfigRow = {
  urlFilterMode: UrlFilterMode;
  urlBlacklist: string[];
  urlWhitelist: string[];
};

const defaultConfig: PortalConfigRow = {
  urlFilterMode: "disabled",
  urlBlacklist: [],
  urlWhitelist: [],
};

function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
}

export async function getPortalConfig(): Promise<PortalConfigRow> {
  try {
    const entries = await db.portalConfig.findMany({
      where: { key: { in: ["urlFilterMode", "urlBlacklist", "urlWhitelist"] } },
    });
    const map = entries.reduce<Record<string, string>>((acc, entry) => {
      acc[entry.key] = entry.value ?? "";
      return acc;
    }, {});

    return {
      urlFilterMode: (map.urlFilterMode as UrlFilterMode) ?? defaultConfig.urlFilterMode,
      urlBlacklist: parseList(map.urlBlacklist),
      urlWhitelist: parseList(map.urlWhitelist),
    };
  } catch (err: any) {
    // If the PortalConfig table doesn't exist yet (eg. fresh DB), return defaults
    if (err && (err.code === "P2021" || (err.meta && err.meta.modelName === "PortalConfig"))) {
      console.warn("PortalConfig table missing, using default config");
      return defaultConfig;
    }
    console.error("error reading portal config", err);
    return defaultConfig;
  }
}

export async function setPortalConfig(config: Partial<PortalConfigRow>) {
  const entries: Array<{ key: string; value: string | null }> = [];

  if (config.urlFilterMode !== undefined) {
    entries.push({ key: "urlFilterMode", value: config.urlFilterMode });
  }
  if (config.urlBlacklist !== undefined) {
    entries.push({ key: "urlBlacklist", value: JSON.stringify(config.urlBlacklist) });
  }
  if (config.urlWhitelist !== undefined) {
    entries.push({ key: "urlWhitelist", value: JSON.stringify(config.urlWhitelist) });
  }

  await Promise.all(
    entries.map((entry) =>
      db.portalConfig.upsert({
        where: { key: entry.key },
        update: { value: entry.value },
        create: { key: entry.key, value: entry.value },
      }),
    ),
  );
}
