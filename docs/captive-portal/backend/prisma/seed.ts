// Optional: seed an example denied student so /api/denied is exercised.
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  await db.student.upsert({
    where: { studentId: "EXAMPLE-DENIED" },
    update: {},
    create: { studentId: "EXAMPLE-DENIED", status: "DENIED" },
  });
}

main().finally(() => db.$disconnect());