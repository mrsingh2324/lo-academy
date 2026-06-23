import { readFileSync } from "fs";
import { prisma } from "../src/lib/prisma";
import type { Prisma } from "@prisma/client";

// Bucket B CORE import (from the master tracking tab — clean & complete).
// Enriches dev_test (Web Dev + React + Bucket B assessment status) and creates
// TR1 (/15) and TR2 (/10) attempts from the tracking scores + hire status.
// Flags bucket-switchers. Idempotent (rebuilds tr1/tr2 per student).

const JSON_PATH = process.argv[2];

type Row = {
  ref: string; name: string | null; cycle: string | null; bucket: string | null; upgrades: string[];
  yog: number | null; webDev: string | null; react: string | null; bucketBStatus: string | null;
  tr1Status: string | null; tr2Status: string | null; tr1Score15: number | null; tr2Score10: number | null; tr1Score10: number | null;
};

function resultOf(status: string | null): "pass" | "fail" | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (/hire|shortlist|cleared|advance|select/.test(s)) return "pass";
  if (/reject|not cleared|fail/.test(s)) return "fail";
  return null;
}

async function main() {
  const rows: Row[] = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  await prisma.reconciliationItem.deleteMany({ where: { source: "bucketB" } });
  let matched = 0, devEnriched = 0, tr1c = 0, tr2c = 0, switched = 0;
  const unmatched: string[] = [];

  for (const r of rows) {
    const student = await prisma.student.findUnique({ where: { externalRef: r.ref }, include: { attempts: true, bucket: true } });
    if (!student) {
      unmatched.push(r.ref);
      await prisma.reconciliationItem.create({
        data: { source: "bucketB", bucket: "B", kind: "unmatched_uid", uid: r.ref, name: r.name ?? undefined,
          detail: { reason: "UID in Bucket B tracking sheet but not in roster" } as Prisma.InputJsonValue },
      });
      continue;
    }
    matched++;

    // bucket switcher: appears in Bucket B sheet but roster bucket isn't B
    if (student.bucket?.name && student.bucket.name !== "B") {
      await prisma.student.update({
        where: { id: student.id },
        data: { anomalousFlow: true, switchedFromBucket: student.bucket.name,
          flowNote: `In Bucket B flow but roster bucket is ${student.bucket.name}${r.upgrades.length ? ` · upgrades: ${r.upgrades.join(" → ")}` : ""}.` },
      });
      await prisma.reconciliationItem.create({
        data: { source: "bucketB", bucket: "B", kind: "bucket_switch", uid: r.ref, name: student.name, resolved: true,
          detail: { reason: `Roster bucket ${student.bucket.name}, present in Bucket B flow`, upgrades: r.upgrades } as Prisma.InputJsonValue },
      });
      switched++;
    } else if (r.upgrades.length > 0) {
      await prisma.student.update({ where: { id: student.id }, data: { flowNote: `Bucket upgrades: ${r.upgrades.join(" → ")}` } });
    }

    // dev_test enrichment
    const dev = student.attempts.find((a) => a.stage === "dev_test");
    if (dev) {
      const devCleared = (r.bucketBStatus ?? "").toLowerCase().includes("clear");
      await prisma.stageAttempt.update({
        where: { id: dev.id },
        data: {
          details: { webDeveloperAssessment: r.webDev, reactDeveloperAssessment: r.react, bucketBAssessmentStatus: r.bucketBStatus, cycle: r.cycle } as Prisma.InputJsonValue,
          outcome: r.bucketBStatus ?? undefined,
          result: devCleared ? "pass" : undefined,
          status: devCleared ? "passed" : undefined,
        },
      });
      devEnriched++;
    }

    // rebuild tr1/tr2 from tracking scores (idempotent)
    const old = student.attempts.filter((a) => a.stage === "tr1" || a.stage === "tr2").map((a) => a.id);
    if (old.length) {
      await prisma.message.deleteMany({ where: { attemptId: { in: old } } });
      await prisma.scheduledJob.deleteMany({ where: { attemptId: { in: old } } });
      await prisma.prepArtifact.deleteMany({ where: { attemptId: { in: old } } });
      await prisma.report.deleteMany({ where: { attemptId: { in: old } } });
      await prisma.stageAttempt.deleteMany({ where: { id: { in: old } } });
    }

    let lastStage = dev ? "dev_test" : student.currentStage;
    let lastId = dev?.id ?? student.currentAttemptId;

    if (r.tr1Score15 != null || r.tr1Status) {
      const res = resultOf(r.tr1Status);
      const a = await prisma.stageAttempt.create({
        data: { studentId: student.id, stage: "tr1", attemptNumber: 1,
          status: res === "pass" ? "passed" : res === "fail" ? "failed" : "evaluated",
          score: r.tr1Score15 ?? undefined, outcome: r.tr1Status ?? undefined, result: res ?? "pending",
          details: { scoreOutOf15: r.tr1Score15, scoreOutOf10: r.tr1Score10, status: r.tr1Status } as Prisma.InputJsonValue },
      });
      lastStage = "tr1"; lastId = a.id; tr1c++;
    }
    if (r.tr2Score10 != null || r.tr2Status) {
      const res = resultOf(r.tr2Status);
      const a = await prisma.stageAttempt.create({
        data: { studentId: student.id, stage: "tr2", attemptNumber: 1,
          status: res === "pass" ? "passed" : res === "fail" ? "failed" : "evaluated",
          score: r.tr2Score10 ?? undefined, outcome: r.tr2Status ?? undefined, result: res ?? "pending",
          details: { scoreOutOf10: r.tr2Score10, status: r.tr2Status } as Prisma.InputJsonValue },
      });
      lastStage = "tr2"; lastId = a.id; tr2c++;
    }

    await prisma.student.update({ where: { id: student.id }, data: { currentStage: lastStage, currentAttemptId: lastId ?? undefined } });
  }

  console.log(`Bucket B core: rows=${rows.length} matched=${matched} devEnriched=${devEnriched} tr1=${tr1c} tr2=${tr2c} switchers=${switched} unmatched=${unmatched.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
