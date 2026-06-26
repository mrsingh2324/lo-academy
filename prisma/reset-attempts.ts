/**
 * Reset the assessment layer so the live importers can rebuild it as the single
 * source of truth (removes stale attempts from earlier imports + their children:
 * panel feedback, reports, prep, messages, jobs). Students themselves are kept.
 *
 * Run: npx tsx prisma/reset-attempts.ts
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  const before = await prisma.stageAttempt.count();
  // children first (FKs to StageAttempt)
  await prisma.panelFeedback.deleteMany({});
  await prisma.report.deleteMany({});
  await prisma.prepArtifact.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.scheduledJob.deleteMany({});
  await prisma.student.updateMany({ data: { currentAttemptId: null } });
  const del = await prisma.stageAttempt.deleteMany({});
  console.log(`reset: deleted ${del.count} attempts (was ${before}) + their children. Students preserved.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
