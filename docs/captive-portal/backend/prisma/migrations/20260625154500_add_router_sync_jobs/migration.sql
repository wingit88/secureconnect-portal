-- Add sync-state columns to Device
ALTER TABLE "Device" ADD COLUMN "syncState" TEXT NOT NULL DEFAULT 'PENDING_SYNC';
ALTER TABLE "Device" ADD COLUMN "syncAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Device" ADD COLUMN "nextRetryAt" DATETIME;
ALTER TABLE "Device" ADD COLUMN "lastSyncedAt" DATETIME;
ALTER TABLE "Device" ADD COLUMN "lastSyncError" TEXT;

-- Durable queue for RouterOS sync work
CREATE TABLE "RouterSyncJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "deviceId" TEXT,
  "studentId" TEXT,
  "jobType" TEXT NOT NULL,
  "payload" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" DATETIME,
  "lastError" TEXT,
  "lockId" TEXT,
  "lockedAt" DATETIME,
  "processedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "RouterSyncJob_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RouterSyncJob_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Device_syncState_nextRetryAt_idx" ON "Device" ("syncState", "nextRetryAt");
CREATE INDEX "RouterSyncJob_status_nextRetryAt_createdAt_idx" ON "RouterSyncJob" ("status", "nextRetryAt", "createdAt");
CREATE INDEX "RouterSyncJob_deviceId_jobType_status_idx" ON "RouterSyncJob" ("deviceId", "jobType", "status");
CREATE INDEX "RouterSyncJob_studentId_jobType_status_idx" ON "RouterSyncJob" ("studentId", "jobType", "status");
