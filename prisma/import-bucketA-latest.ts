import { readFileSync } from "fs";
import { prisma } from "../src/lib/prisma";
import type { Prisma } from "@prisma/client";

// Latest Bucket A TR1/TR2 (external-panelist sheet). Authoritative — rebuilds
// each student's tr1/tr2 attempts from this data. Repeat interviews (distinct
// dates) become attempt #1, #2 … TR pass threshold = 70%.
const JSON_PATH = process.argv[2];
type Att = { name: string | null; interviewDateISO: string | null; status: string | null; score: number | null; result: string; finalStatus: string | null; details: Record<string, unknown> };

async function rebuild(studentId: string, stage: string, atts: Att[]) {
  const old = (await prisma.stageAttempt.findMany({ where: { studentId, stage }, select: { id: true } })).map((a) => a.id);
  if (old.length) {
    await prisma.message.deleteMany({ where: { attemptId: { in: old } } });
    await prisma.scheduledJob.deleteMany({ where: { attemptId: { in: old } } });
    await prisma.prepArtifact.deleteMany({ where: { attemptId: { in: old } } });
    await prisma.report.deleteMany({ where: { attemptId: { in: old } } });
    await prisma.stageAttempt.deleteMany({ where: { id: { in: old } } });
  }
  let n = 0, lastId = "";
  for (const a of atts) {
    n++;
    const status = a.result === "pass" ? "passed" : a.result === "fail" ? "failed" : "evaluated";
    const created = await prisma.stageAttempt.create({
      data: {
        studentId, stage, attemptNumber: n, status,
        attendedAt: a.interviewDateISO ? new Date(a.interviewDateISO) : undefined,
        scheduledAt: a.interviewDateISO ? new Date(a.interviewDateISO) : undefined,
        score: a.score ?? undefined, result: a.result === "pending" ? "pending" : a.result,
        outcome: a.finalStatus ?? undefined, details: a.details as Prisma.InputJsonValue,
      },
    });
    lastId = created.id;
  }
  return { count: n, lastId, last: atts[atts.length - 1] };
}

async function main() {
  const data: Record<string, { tr1: Att[]; tr2: Att[] }> = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  let matched = 0, tr1Total = 0, tr2Total = 0, repeats = 0, unmatched = 0;

  for (const [ref, rec] of Object.entries(data)) {
    const student = await prisma.student.findUnique({ where: { externalRef: ref } });
    if (!student) { unmatched++; continue; }
    matched++;
    if (rec.tr1.length > 1 || rec.tr2.length > 1) repeats++;

    const r1 = rec.tr1.length ? await rebuild(student.id, "tr1", rec.tr1) : null;
    const r2 = rec.tr2.length ? await rebuild(student.id, "tr2", rec.tr2) : null;
    tr1Total += r1?.count ?? 0; tr2Total += r2?.count ?? 0;

    // nxtmock cleared (they reached TR) — keep coherent
    await prisma.stageAttempt.updateMany({ where: { studentId: student.id, stage: "nxtmock", result: { not: "pass" } }, data: { result: "pass", status: "passed" } });

    // current stage/status from the latest round reached
    let stage = student.currentStage, status = student.currentStatus, attemptId = student.currentAttemptId;
    if (r2) {
      const passed = r2.last.result === "pass"; // ≥70%
      stage = passed ? "placement_pool" : "tr2";
      status = passed ? "passed" : r2.last.result === "fail" ? "failed" : "evaluated";
      attemptId = r2.lastId;
    } else if (r1) {
      stage = "tr1"; status = r1.last.result === "pass" ? "passed" : r1.last.result === "fail" ? "failed" : "evaluated"; attemptId = r1.lastId;
    }
    await prisma.student.update({
      where: { id: student.id },
      data: { currentStage: stage, currentStatus: status, currentAttemptId: attemptId ?? undefined, ...(stage === "placement_pool" ? { finalPortalRedirectedAt: new Date() } : {}) },
    });
  }
  console.log(`Latest Bucket A: matched=${matched} tr1_attempts=${tr1Total} tr2_attempts=${tr2Total} students_with_repeats=${repeats} unmatched=${unmatched}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
