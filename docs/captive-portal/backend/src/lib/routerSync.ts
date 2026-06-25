import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  addHotspotUser,
  disconnectByMac,
  provisionHotspotAccess,
  removeAllUsersForStudent,
  removeHotspotUserByMac,
} from "@/lib/mikrotik";

type SyncJobType =
  | "DEVICE_APPROVE"
  | "DEVICE_REJECT"
  | "DEVICE_REVOKE"
  | "STUDENT_REVOKE"
  | "STUDENT_DENY"
  | "STUDENT_DELETE"
  | "STUDENT_SET_SPEED";

type JobPayload = {
  deviceId?: string;
  studentId?: string;
  studentCode?: string;
  macList?: string[];
  username?: string;
  mac?: string;
  speedLimitKbps?: number | null;
};

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1500;
let draining = false;
let workerStarted = false;

function nextBackoff(attempt: number): Date {
  const ms = BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1));
  return new Date(Date.now() + ms);
}

async function markDeviceSynced(deviceId: string): Promise<void> {
  await db.device.update({
    where: { id: deviceId },
    data: {
      syncState: "SYNCED",
      syncAttempts: 0,
      nextRetryAt: null,
      lastSyncError: null,
      lastSyncedAt: new Date(),
    },
  });
}

async function markDeviceSyncFailed(deviceId: string, message: string, attempts: number): Promise<void> {
  await db.device.update({
    where: { id: deviceId },
    data: {
      syncState: "SYNC_FAILED",
      syncAttempts: attempts,
      nextRetryAt: nextBackoff(attempts),
      lastSyncError: message.slice(0, 500),
    },
  });
}

async function runJob(jobType: string, payload: JobPayload): Promise<void> {
  if (jobType === "DEVICE_APPROVE") {
    if (!payload.deviceId || !payload.username || !payload.mac) return;
    await provisionHotspotAccess(payload.username, payload.mac, payload.speedLimitKbps ?? undefined);
    await markDeviceSynced(payload.deviceId);
    return;
  }

  if (jobType === "DEVICE_REJECT") {
    if (!payload.mac) return;
    await disconnectByMac(payload.mac).catch(() => {});
    await removeHotspotUserByMac(payload.mac).catch(() => {});
    return;
  }

  if (jobType === "DEVICE_REVOKE") {
    if (!payload.deviceId || !payload.mac) return;
    await disconnectByMac(payload.mac).catch(() => {});
    await removeHotspotUserByMac(payload.mac).catch(() => {});
    await markDeviceSynced(payload.deviceId);
    return;
  }

  if (jobType === "STUDENT_REVOKE" || jobType === "STUDENT_DENY") {
    if (!payload.studentId) return;
    const student = await db.student.findUnique({
      where: { id: payload.studentId },
      include: { devices: true },
    });
    if (!student) return;
    await removeAllUsersForStudent(student.studentId).catch(() => {});
    for (const d of student.devices) {
      await disconnectByMac(d.macAddress).catch(() => {});
    }
    await db.device.updateMany({
      where: { studentId: student.id },
      data: {
        syncState: "SYNCED",
        syncAttempts: 0,
        nextRetryAt: null,
        lastSyncError: null,
        lastSyncedAt: new Date(),
      },
    }).catch(() => {});
    return;
  }

  if (jobType === "STUDENT_DELETE") {
    if (!payload.studentCode) return;
    await removeAllUsersForStudent(payload.studentCode).catch(() => {});
    for (const mac of payload.macList ?? []) {
      await disconnectByMac(mac).catch(() => {});
    }
    return;
  }

  if (jobType === "STUDENT_SET_SPEED") {
    if (!payload.studentId) return;
    const student = await db.student.findUnique({
      where: { id: payload.studentId },
      include: { devices: true },
    });
    if (!student) return;
    for (const d of student.devices) {
      if (!d.approved) continue;
      const username = await db.device.count({ where: { studentId: student.id, approved: true, createdAt: { lte: d.createdAt } } })
        .then((siblings) => (siblings <= 1 ? student.studentId : `${student.studentId}#${siblings}`));
      await addHotspotUser(username, d.macAddress, payload.speedLimitKbps ?? undefined);
      await markDeviceSynced(d.id).catch(() => {});
    }
  }
}

export async function enqueueRouterSync(jobType: SyncJobType, payload: JobPayload): Promise<void> {
  await db.$transaction((tx) => enqueueRouterSyncTx(tx, jobType, payload));
  void drainRouterSyncQueue();
}

export async function enqueueRouterSyncTx(
  tx: Prisma.TransactionClient,
  jobType: SyncJobType,
  payload: JobPayload,
): Promise<void> {
  if (payload.deviceId) {
    await tx.device.update({
      where: { id: payload.deviceId },
      data: {
        syncState: "PENDING_SYNC",
        syncAttempts: 0,
        nextRetryAt: null,
        lastSyncError: null,
      },
    });
  }
  await tx.routerSyncJob.create({
    data: {
      jobType,
      deviceId: payload.deviceId,
      studentId: payload.studentId,
      payload: JSON.stringify(payload),
      status: "PENDING",
      nextRetryAt: new Date(),
    },
  });
}

export async function drainRouterSyncQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (true) {
      const job = await db.routerSyncJob.findFirst({
        where: {
          status: "PENDING",
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
        },
        orderBy: { createdAt: "asc" },
      });
      if (!job) break;

      const payload: JobPayload = job.payload ? JSON.parse(job.payload) as JobPayload : {};
      try {
        console.info(`[router-sync] processing job ${job.id} type=${job.jobType} attempt=${job.attempts + 1}`);
        await runJob(job.jobType, payload);
        await db.routerSyncJob.update({
          where: { id: job.id },
          data: {
            status: "DONE",
            processedAt: new Date(),
            lastError: null,
            attempts: { increment: 1 },
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const attempts = job.attempts + 1;
        const failedPermanently = attempts >= MAX_ATTEMPTS;
        await db.routerSyncJob.update({
          where: { id: job.id },
          data: {
            status: failedPermanently ? "FAILED" : "PENDING",
            attempts,
            lastError: message.slice(0, 500),
            nextRetryAt: failedPermanently ? null : nextBackoff(attempts),
          },
        });
        if (payload.deviceId) {
          await markDeviceSyncFailed(payload.deviceId, message, attempts).catch(() => {});
        }
        console.warn(`[router-sync] job failed id=${job.id} type=${job.jobType} attempts=${attempts}: ${message}`);
      }
    }
  } finally {
    draining = false;
  }
}

async function processJob(job: { id: string; jobType: string; payload: string | null; attempts: number }, payload: JobPayload): Promise<void> {
  await runJob(job.jobType, payload);
  await db.routerSyncJob.update({
    where: { id: job.id },
    data: {
      status: "DONE",
      processedAt: new Date(),
      lastError: null,
      attempts: { increment: 1 },
    },
  });
}

async function processJobWithRetry(job: {
  id: string;
  jobType: string;
  payload: string | null;
  attempts: number;
}): Promise<void> {
  const payload: JobPayload = job.payload ? (JSON.parse(job.payload) as JobPayload) : {};
  try {
    await processJob(job, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = job.attempts + 1;
    const failedPermanently = attempts >= MAX_ATTEMPTS;
    await db.routerSyncJob.update({
      where: { id: job.id },
      data: {
        status: failedPermanently ? "FAILED" : "PENDING",
        attempts,
        lastError: message.slice(0, 500),
        nextRetryAt: failedPermanently ? null : nextBackoff(attempts),
      },
    });
    if (payload.deviceId) {
      await markDeviceSyncFailed(payload.deviceId, message, attempts).catch(() => {});
    }
    throw err;
  }
}

export async function drainRouterSyncQueueForDevice(
  deviceId: string,
  jobType?: SyncJobType,
  maxJobs = 3,
): Promise<void> {
  // This function is intentionally not using the global `draining` lock: it's used
  // to prioritize interactive admin actions and drain only a narrow set.
  let processed = 0;
  while (processed < maxJobs) {
    const job = await db.routerSyncJob.findFirst({
      where: {
        status: "PENDING",
        deviceId,
        ...(jobType ? { jobType } : {}),
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: "asc" },
    });
    if (!job) return;
    processed += 1;
    const payload: JobPayload = job.payload ? (JSON.parse(job.payload) as JobPayload) : {};
    try {
      console.info(`[router-sync] processing targeted job ${job.id} type=${job.jobType} attempt=${job.attempts + 1}`);
      await runJob(job.jobType, payload);
      await db.routerSyncJob.update({
        where: { id: job.id },
        data: {
          status: "DONE",
          processedAt: new Date(),
          lastError: null,
          attempts: { increment: 1 },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = job.attempts + 1;
      const failedPermanently = attempts >= MAX_ATTEMPTS;
      await db.routerSyncJob.update({
        where: { id: job.id },
        data: {
          status: failedPermanently ? "FAILED" : "PENDING",
          attempts,
          lastError: message.slice(0, 500),
          nextRetryAt: failedPermanently ? null : nextBackoff(attempts),
        },
      });
      if (payload.deviceId) {
        await markDeviceSyncFailed(payload.deviceId, message, attempts).catch(() => {});
      }
      // Stop early if the job isn't going to succeed right now; retries are scheduled.
      return;
    }
  }
}

export async function reconcileRouterSyncState(): Promise<void> {
  const stale = await db.device.findMany({
    where: {
      approved: true,
      syncState: "SYNC_FAILED",
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    include: { student: true },
    take: 50,
  });

  for (const device of stale) {
    const siblings = await db.device.count({
      where: { studentId: device.studentId, approved: true, createdAt: { lte: device.createdAt } },
    });
    const username = siblings <= 1 ? device.student.studentId : `${device.student.studentId}#${siblings}`;
    await enqueueRouterSync("DEVICE_APPROVE", {
      deviceId: device.id,
      studentId: device.studentId,
      username,
      mac: device.macAddress,
      speedLimitKbps: device.student.speedLimitKbps,
    });
  }
}

export function startRouterSyncWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  void drainRouterSyncQueue();
  setInterval(() => {
    void drainRouterSyncQueue();
    void reconcileRouterSyncState();
  }, 15_000);
}

// Ensure sync worker exists in any runtime that imports routerSync
// (API routes, admin pages, server actions).
startRouterSyncWorker();
