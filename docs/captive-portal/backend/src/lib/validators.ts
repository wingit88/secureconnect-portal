import { z } from "zod";

export const macSchema = z.string().min(11).max(32);
export const ipSchema = z.string().ip({ version: "v4" });
export const studentIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Letters, digits, _ and - only");

export const loginSchema = z.object({
  studentId: studentIdSchema,
  mac: macSchema,
  ip: ipSchema,
  target: z.string().url().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const adminLoginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(200),
});

export const idParamSchema = z.object({ id: z.string().min(1).max(64) });