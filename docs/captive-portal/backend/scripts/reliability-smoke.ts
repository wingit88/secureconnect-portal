import { db } from "../src/lib/db";

async function expectStatus(url: string, expected: number): Promise<void> {
  const res = await fetch(url, { redirect: "manual" });
  if (res.status !== expected) {
    throw new Error(`${url} expected HTTP ${expected} but got ${res.status}`);
  }
}

async function main() {
  const baseUrl = process.env.PORTAL_BASE_URL ?? "http://127.0.0.1";
  await expectStatus(`${baseUrl}/api/captive`, 200);
  await expectStatus(`${baseUrl}/api/denied`, 200);
  await expectStatus(`${baseUrl}/api/admin/students`, 401);

  const jobs = await db.routerSyncJob.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const failed = jobs.find((j) => j.status === "FAILED")?._count._all ?? 0;

  console.log("Reliability smoke checks passed.");
  console.log(`Router sync jobs by status: ${JSON.stringify(jobs)}`);
  if (failed > 0) {
    console.warn(`Warning: ${failed} router sync job(s) are in FAILED state.`);
  }
}

main()
  .catch((err) => {
    console.error("Reliability smoke checks failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
