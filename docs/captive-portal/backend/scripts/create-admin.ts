// Interactive: bun run create-admin  /  npm run create-admin
// Creates or updates an admin user. Prompts for email + password.
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

async function main() {
  const db = new PrismaClient();
  const rl = readline.createInterface({ input, output });
  const email = (await rl.question("Admin email: ")).trim().toLowerCase();
  const password = await rl.question("Password (min 12 chars): ");
  rl.close();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("invalid email");
  if (password.length < 12) throw new Error("password too short");

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const u = await db.adminUser.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });
  console.log(`Admin ready: ${u.email}`);
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });