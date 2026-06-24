-- Initial SQLite schema for the captive portal backend.
-- Student.status is a string because Prisma's SQLite connector does not support enums.

CREATE TABLE "Student" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "studentId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Device" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "macAddress" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "approved" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Device_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AdminUser" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "target" TEXT,
  "meta" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "Student_studentId_key" ON "Student" ("studentId");
CREATE INDEX "Student_status_idx" ON "Student" ("status");

CREATE UNIQUE INDEX "Device_macAddress_key" ON "Device" ("macAddress");
CREATE INDEX "Device_studentId_idx" ON "Device" ("studentId");
CREATE INDEX "Device_approved_idx" ON "Device" ("approved");

CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser" ("email");

CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog" ("createdAt");