-- Add student profile fields and device hostname from MikroTik.

ALTER TABLE "Student" ADD COLUMN "nama" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Student" ADD COLUMN "kelas" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Device" ADD COLUMN "hostname" TEXT;
