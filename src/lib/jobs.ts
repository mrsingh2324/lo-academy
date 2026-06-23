import { prisma } from "./prisma";
import { sendMessage } from "./adapters";
import { transition } from "./stateMachine";
import { nextWeekendSlots } from "./slots";
import { generateTrReport } from "./report";
import { getSetting } from "./settings";
import { isTestStage } from "./enums";
import { audit } from "./audit";
import type { Prisma } from "@prisma/client";

/**
 * Minimal durable-job processor (§5.7, §7). In production a worker + cron
 * promotes due jobs every minute; here it runs on demand via /api/jobs/run.
 * Each job is idempotent — re-running never double-sends (guarded by message
 * uniqueness, attempt.notifiedAt, and job status). Failed `notify_result` jobs
 * retry with backoff, then flag the attempt for review.
 */
export async function runDueJobs(now: Date = new Date()) {
  const due = await prisma.scheduledJob.findMany({
    where: { status: "pending", runAt: { lte: now } },
    orderBy: { runAt: "asc" },
    take: 100,
  });

  const log: { id: string; type: string; result: string }[] = [];
  for (const job of due) {
    try {
      await processOne(job);
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: { status: "done", executedAt: new Date(), attempts: { increment: 1 } },
      });
      log.push({ id: job.id, type: job.type, result: "done" });
    } catch (e) {
      const msg = (e as Error).message;
      const attemptsNow = job.attempts + 1;
      const maxRetries = job.type === "notify_result" ? await getSetting("notify_max_retries") : 0;
      if (job.type === "notify_result" && attemptsNow < maxRetries) {
        // retry with exponential backoff (cap 60 min)
        const backoffMin = Math.min(2 ** attemptsNow, 60);
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: { status: "pending", attempts: { increment: 1 }, runAt: new Date(now.getTime() + backoffMin * 60_000), payload: { error: msg } as Prisma.InputJsonValue },
        });
        log.push({ id: job.id, type: job.type, result: `retry ${attemptsNow}/${maxRetries} in ${backoffMin}m: ${msg}` });
      } else {
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: { status: "failed", attempts: { increment: 1 }, payload: { error: msg } as Prisma.InputJsonValue },
        });
        // exhausted retries → flag the attempt for human review rather than drop it
        if (job.type === "notify_result" && job.attemptId) {
          const a = await prisma.stageAttempt.findUnique({ where: { id: job.attemptId } });
          if (a && a.status === "released") {
            await transition(job.attemptId, "needs_review", { needsReviewReason: `send failed after ${attemptsNow} attempts: ${msg}` });
          }
        }
        log.push({ id: job.id, type: job.type, result: `failed: ${msg}` });
      }
    }
  }
  return log;
}

async function processOne(job: { id: string; type: string; attemptId: string | null }) {
  if (job.type === "notify_result") return notifyResult(job.attemptId);
  if (!job.attemptId) return;
  const attempt = await prisma.stageAttempt.findUnique({ where: { id: job.attemptId } });
  if (!attempt) return;

  switch (job.type) {
    case "fixed_slot_send":
      if (attempt.status === "scheduled") await transition(attempt.id, "awaiting_result", {});
      break;
    case "send_reminder":
      await sendMessage(prisma, { studentId: attempt.studentId, attemptId: attempt.id, templateKey: "reminder", payload: { stage: attempt.stage } });
      break;
    case "reopen_attempt": {
      const existing = await prisma.stageAttempt.count({ where: { studentId: attempt.studentId, stage: attempt.stage } });
      const slots = nextWeekendSlots();
      const next = await prisma.stageAttempt.create({
        data: { studentId: attempt.studentId, stage: attempt.stage, attemptNumber: existing + 1, status: "availability_requested", availabilityOptions: slots as unknown as Prisma.InputJsonValue },
      });
      await prisma.student.update({ where: { id: attempt.studentId }, data: { currentStatus: "availability_requested", currentAttemptId: next.id } });
      await sendMessage(prisma, { studentId: attempt.studentId, attemptId: next.id, templateKey: "availability_request", payload: { stage: attempt.stage, slots, reattempt: true } });
      break;
    }
    case "escalate_no_response":
    case "redirect_final":
      break;
  }
}

/**
 * Result-notification pipeline (fires when a released attempt's job runs).
 * Idempotent, validates, generates-then-attaches a report on FAIL, sends once,
 * marks `notified`, then branches passed/failed. Throws on failure so the job
 * retries with backoff.
 */
async function notifyResult(attemptId: string | null) {
  if (!attemptId) return;
  const attempt = await prisma.stageAttempt.findUnique({ where: { id: attemptId }, include: { student: true } });
  if (!attempt) return;

  // Idempotency: never notify twice; only act on a still-released attempt.
  if (attempt.notifiedAt || ["notified", "passed", "failed"].includes(attempt.status)) return;
  if (attempt.status !== "released") return; // cancelled / needs_review / not released

  const stage = attempt.stage;
  const isTest = isTestStage(stage);

  // Validate before sending.
  const reasons: string[] = [];
  if (attempt.score == null) reasons.push("score missing");
  else if (attempt.score < 0) reasons.push("score out of range");
  if (!attempt.remarks || !attempt.remarks.trim()) reasons.push("remarks missing");
  const email = attempt.student.email;
  const hasContact = (!!email && !email.endsWith("@placeholder.invalid")) || !!attempt.student.phone;
  if (!hasContact) reasons.push("no valid contact");
  if (reasons.length) {
    await transition(attemptId, "needs_review", { needsReviewReason: reasons.join(", ") });
    return;
  }

  const result: "pass" | "fail" = attempt.result === "pass" ? "pass" : "fail";

  // FAIL → generate & attach the report/guideline BEFORE sending (go out together).
  let reportId: string | null = null;
  if (result === "fail") {
    if (isTest) {
      const exists = await prisma.prepArtifact.count({ where: { attemptId } });
      if (!exists) {
        await prisma.prepArtifact.create({ data: { attemptId, type: "react_guideline", body: `Preparation guideline for your ${stage.toUpperCase()} reattempt.` } });
      }
    } else {
      const report = await generateTrReport(attemptId);
      reportId = (report as { id?: string } | null)?.id ?? null;
    }
  }

  // Render + send the result (marks + remarks + report/prep) via the messaging integration.
  await sendMessage(prisma, {
    studentId: attempt.studentId,
    attemptId,
    templateKey: result === "pass" ? "result_pass" : isTest ? "result_fail_test" : "result_fail_tr",
    payload: { stage, score: attempt.score, remarks: attempt.remarks, reportId, reportAttached: result === "fail" },
  });

  // Mark notified (send already succeeded), then branch.
  await transition(attemptId, "notified", {});
  await audit(prisma, { entity: "stage_attempt", entityId: attemptId, action: "result_notified", after: { result, reportId } });
  await transition(attemptId, result === "pass" ? "passed" : "failed", { result });
}
