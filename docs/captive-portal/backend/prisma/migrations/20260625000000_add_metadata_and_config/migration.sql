-- Add metadata columns to Student table
ALTER TABLE "Student" ADD COLUMN "nama" TEXT;
ALTER TABLE "Student" ADD COLUMN "kelas" TEXT;
ALTER TABLE "Student" ADD COLUMN "speedLimitKbps" INTEGER;

-- Create PortalConfig table for URL filtering settings
CREATE TABLE "PortalConfig" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "value" TEXT
);
