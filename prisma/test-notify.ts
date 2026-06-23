import { prisma } from "../src/lib/prisma";
import { releaseAttempts, cancelRelease } from "../src/lib/release";
import { runDueJobs } from "../src/lib/jobs";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) { if (cond) { pass++; console.log("  ✓", msg); } else { fail++; console.log("  ✗", msg); } }

async function cleanup(ref: string) {
  const s = await prisma.student.findUnique({ where: { externalRef: ref } });
  if (!s) return;
  const atts = (await prisma.stageAttempt.findMany({ where: { studentId: s.id }, select: { id: true } })).map((a) => a.id);
  await prisma.scheduledJob.deleteMany({ where: { attemptId: { in: atts } } });
  await prisma.message.deleteMany({ where: { studentId: s.id } });
  await prisma.report.deleteMany({ where: { studentId: s.id } });
  await prisma.prepArtifact.deleteMany({ where: { attemptId: { in: atts } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [s.id, ...atts] } } });
  await prisma.stageAttempt.deleteMany({ where: { studentId: s.id } });
  await prisma.student.delete({ where: { id: s.id } });
}

async function setup(ref: string, opts: { email: string; phone: string | null; result: "pass" | "fail"; score: number | null; remarks: string | null; stage?: string }) {
  await cleanup(ref);
  const bucket = await prisma.bucket.upsert({ where: { name: "A" }, create: { name: "A" }, update: {} });
  const student = await prisma.student.create({
    data: { externalRef: ref, name: "Notify Test", email: opts.email, phone: opts.phone, bucketId: bucket.id, currentStage: opts.stage ?? "tr1", currentStatus: "evaluated" },
  });
  const att = await prisma.stageAttempt.create({
    data: { studentId: student.id, stage: opts.stage ?? "tr1", attemptNumber: 1, status: "evaluated", score: opts.score, remarks: opts.remarks, result: opts.result },
  });
  await prisma.student.update({ where: { id: student.id }, data: { currentAttemptId: att.id } });
  return att.id;
}
const resultMsgs = (attemptId: string) =>
  prisma.message.count({ where: { attemptId, templateKey: { in: ["result_pass", "result_fail_tr", "result_fail_test"] } } });

async function main() {
  const REFS = ["TEST-NOTIFY-PASS", "TEST-NOTIFY-INVALID", "TEST-NOTIFY-FAIL", "TEST-NOTIFY-CANCEL"];

  // T1 — released + valid → exactly one notification + branch (pass → notified → passed)
  console.log("T1: valid pass → one notification + branch");
  const a1 = await setup(REFS[0], { email: "t1@real.com", phone: "9990000001", result: "pass", score: 80, remarks: "Strong." });
  await releaseAttempts([a1]);
  await runDueJobs();
  let at = await prisma.stageAttempt.findUnique({ where: { id: a1 } });
  ok((await resultMsgs(a1)) === 1, "exactly one result notification sent");
  ok(at?.status === "passed" && at?.notifiedAt != null, "attempt branched to passed + notifiedAt set");
  const next = await prisma.stageAttempt.findFirst({ where: { studentId: at!.studentId, stage: "tr2" } });
  ok(!!next, "pass branch opened the next round (tr2)");

  // T2 — idempotent: re-run sends nothing twice
  console.log("T2: idempotent re-run");
  await releaseAttempts([a1]); // no-op (not evaluated anymore)
  await runDueJobs();
  await runDueJobs();
  ok((await resultMsgs(a1)) === 1, "still exactly one notification after re-runs");

  // T3 — missing remarks + placeholder contact → needs_review, no send
  console.log("T3: invalid data → needs_review, no send");
  const a3 = await setup(REFS[1], { email: "x@placeholder.invalid", phone: null, result: "pass", score: 70, remarks: null });
  await releaseAttempts([a3]);
  await runDueJobs();
  at = await prisma.stageAttempt.findUnique({ where: { id: a3 } });
  ok(at?.status === "needs_review", "invalid attempt set to needs_review");
  ok((await resultMsgs(a3)) === 0, "no notification sent for invalid attempt");
  ok(!!at?.needsReviewReason, `reason recorded: ${at?.needsReviewReason}`);

  // T4 — fail generates + attaches a report BEFORE sending
  console.log("T4: fail → report generated then sent");
  const a4 = await setup(REFS[2], { email: "t4@real.com", phone: "9990000004", result: "fail", score: 35, remarks: "Needs work." });
  await releaseAttempts([a4]);
  await runDueJobs();
  at = await prisma.stageAttempt.findUnique({ where: { id: a4 } });
  const report = await prisma.report.findFirst({ where: { attemptId: a4 } });
  ok(!!report, "TR report generated for the fail");
  ok((await resultMsgs(a4)) === 1, "fail result sent once (with report)");
  ok(at?.status === "failed" && at?.notifiedAt != null, "attempt branched to failed + notified");

  // T5 — cancel within the window prevents the send
  console.log("T5: cancel prevents send");
  const a5 = await setup(REFS[3], { email: "t5@real.com", phone: "9990000005", result: "pass", score: 90, remarks: "Great." });
  await releaseAttempts([a5]);
  const cancelled = await cancelRelease([a5]);
  await runDueJobs();
  at = await prisma.stageAttempt.findUnique({ where: { id: a5 } });
  ok(cancelled === 1, "cancel returned 1");
  ok(at?.status === "evaluated" && at?.notifiedAt == null, "attempt reverted to evaluated, not notified");
  ok((await resultMsgs(a5)) === 0, "no notification sent after cancel");

  for (const r of REFS) await cleanup(r);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
