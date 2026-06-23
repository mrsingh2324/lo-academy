import { prisma } from "./prisma";
import { transition } from "./stateMachine";
import { audit } from "./audit";
import { getSetting } from "./settings";
import type { Prisma } from "@prisma/client";

// Resolve a batch filter (stage / bucket / slot-date) to releasable attempt ids.
export async function findReleasable(filter: { stage?: string; bucket?: string; date?: string }) {
  const where: Prisma.StageAttemptWhereInput = { status: "evaluated" };
  if (filter.stage) where.stage = filter.stage;
  if (filter.bucket) where.student = { bucket: { name: filter.bucket } };
  if (filter.date) {
    const start = new Date(filter.date + "T00:00:00");
    const end = new Date(filter.date + "T23:59:59");
    where.scheduledAt = { gte: start, lte: end };
  }
  return prisma.stageAttempt.findMany({ where, select: { id: true } });
}

/**
 * The ONLY human step. Move evaluated attempts → released and enqueue a durable
 * `notify_result` job (run after the configured safety delay). The sweep in
 * jobs.ts does validation + send + branch with no further human involvement.
 */
export async function releaseAttempts(attemptIds: string[], actorId?: string | null) {
  const delayMin = await getSetting("result_notify_delay_min");
  let released = 0;
  for (const id of attemptIds) {
    const a = await prisma.stageAttempt.findUnique({ where: { id } });
    if (!a || a.status !== "evaluated") continue; // only finalized scores can be released
    await transition(id, "released", {}, actorId);
    const runAt = new Date(Date.now() + delayMin * 60_000);
    await prisma.scheduledJob.create({ data: { attemptId: id, type: "notify_result", runAt, payload: {} } });
    released++;
  }
  await audit(prisma, { entity: "results", entityId: "release", actorId, action: "release", after: { count: released } });
  return released;
}

/**
 * Safety net: pull back a release before the student is notified. Skips the
 * pending job and reverts the attempt to `evaluated`. No-op once notified.
 */
export async function cancelRelease(attemptIds: string[], actorId?: string | null) {
  let cancelled = 0;
  for (const id of attemptIds) {
    const a = await prisma.stageAttempt.findUnique({ where: { id } });
    if (!a || a.status !== "released" || a.notifiedAt) continue;
    await prisma.scheduledJob.updateMany({ where: { attemptId: id, type: "notify_result", status: "pending" }, data: { status: "skipped" } });
    await prisma.stageAttempt.update({ where: { id }, data: { status: "evaluated", releasedAt: null } });
    await prisma.student.update({ where: { id: a.studentId }, data: { currentStatus: "evaluated" } });
    await audit(prisma, { entity: "stage_attempt", entityId: id, actorId, action: "release_cancelled" });
    cancelled++;
  }
  return cancelled;
}
