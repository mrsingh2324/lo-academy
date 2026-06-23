import { readFileSync } from "fs";
import { prisma } from "../src/lib/prisma";
import type { Prisma } from "@prisma/client";

// Bucket B DETAIL: the multi-part evaluations.
//  - Frontend (Dev test) 3-part eval → merged into the dev_test attempt's details.
//  - DSA multi-part eval → Student.dsaEvaluation (its own section).
const JSON_PATH = process.argv[2];

async function main() {
  const data: Record<string, { frontend: unknown; dsa: unknown }> = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  let feApplied = 0, dsaApplied = 0, unmatched = 0;

  for (const [ref, rec] of Object.entries(data)) {
    const student = await prisma.student.findUnique({ where: { externalRef: ref }, include: { attempts: { where: { stage: "dev_test" } } } });
    if (!student) { unmatched++; continue; }

    if (rec.frontend) {
      const dev = student.attempts[0];
      if (dev) {
        const details = { ...((dev.details as object) ?? {}), frontendEvaluation: rec.frontend };
        await prisma.stageAttempt.update({ where: { id: dev.id }, data: { details: details as Prisma.InputJsonValue } });
        feApplied++;
      }
    }
    if (rec.dsa) {
      await prisma.student.update({ where: { id: student.id }, data: { dsaEvaluation: rec.dsa as Prisma.InputJsonValue } });
      dsaApplied++;
    }
  }
  console.log(`Bucket B detail: frontend applied=${feApplied} | dsa applied=${dsaApplied} | unmatched=${unmatched}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
