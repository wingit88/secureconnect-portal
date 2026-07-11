import { z } from "zod";

export const macSchema = z.string().min(11).max(32);
export const ipSchema = z.string().ip({ version: "v4" });
export const studentIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Letters, digits, _ and - only");

export const namaSchema = z
  .string()
  .trim()
  .min(2, "Nama minimal 2 karakter")
  .max(100, "Nama maksimal 100 karakter");

export const kelasSchema = z
  .string()
  .trim()
  .min(1, "Kelas wajib diisi")
  .max(50, "Kelas maksimal 50 karakter");

export const loginSchema = z.object({
  studentId: studentIdSchema,
  nama: namaSchema,
  kelas: kelasSchema,
  mac: macSchema,
  ip: ipSchema,
  target: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().url().optional(),
  ),
  reason: z.string().trim().max(500).optional(),
});

export const adminLoginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(200),
});

export const idParamSchema = z.object({ id: z.string().min(1).max(64) });