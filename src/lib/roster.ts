import type { Prisma } from "@prisma/client";
import { BUCKET_PIPELINES } from "@/lib/enums";

export type RosterParams = { stage?: string; stageStatus?: string; bucket?: string; q?: string; yog?: string; outcome?: string; progress?: string };

// Outcome buckets: a high-level cleared / failed / in-process split.
export const OUTCOMES = ["cleared", "failed", "in_process"] as const;
export const OUTCOME_LABELS: Record<string, string> = { cleared: "Cleared", failed: "Failed", in_process: "In process" };

// Per-stage four-state status (used with a chosen `stage`). Derived from the
// student's attempt results at that stage + where they currently sit:
//   cleared          → has a passed attempt at the stage (≥70%, moved on)
//   appeared_failed  → appeared but a failed/below-70% attempt at the stage
//   not_appeared     → eligible (currently AT this stage) but no appearance yet
export const STAGE_STATUSES = ["cleared", "appeared_failed", "not_appeared"] as const;
export const STAGE_STATUS_LABELS: Record<string, string> = {
  cleared: "Cleared",
  appeared_failed: "Appeared · not cleared",
  not_appeared: "Eligible · not appeared",
};

function stageStatusWhere(stage: string, status: string): Prisma.StudentWhereInput | null {
  if (status === "cleared") return { attempts: { some: { stage, result: "pass" } } };
  if (status === "appeared_failed") return { attempts: { some: { stage, result: "fail" } } };
  if (status === "not_appeared")
    return { currentStage: stage, NOT: { attempts: { some: { stage, result: { in: ["pass", "fail"] } } } } };
  return null;
}

// Cross-bucket progress filter: students who have NOT moved past the FIRST stage
// of their bucket's pipeline — i.e. still sitting at NxtMock (A) / Dev test (B) /
// TR1 (C). "Haven't gone through even the first stage." Derived from
// BUCKET_PIPELINES so it stays correct if pipelines change.
export const PROGRESS_FILTERS = ["at_first_stage"] as const;
export const PROGRESS_LABELS: Record<string, string> = {
  at_first_stage: "Stuck at first stage",
};

function progressWhere(progress: string): Prisma.StudentWhereInput | null {
  if (progress === "at_first_stage") {
    const or = Object.entries(BUCKET_PIPELINES)
      .map(([bucket, pipe]) => (pipe[0] ? { bucket: { name: bucket }, currentStage: pipe[0] } : null))
      .filter(Boolean) as Prisma.StudentWhereInput[];
    return or.length ? { OR: or } : null;
  }
  return null;
}

function outcomeWhere(outcome: string): Prisma.StudentWhereInput | null {
  if (outcome === "cleared") return { currentStage: "placement_pool" };
  if (outcome === "failed") return { OR: [{ currentStatus: "failed" }, { currentStage: "rejected" }] };
  if (outcome === "in_process") return { currentStage: { notIn: ["placement_pool", "rejected"] }, currentStatus: { not: "failed" } };
  return null;
}

// Single source of truth for the roster filter — used by the roster list, the
// bulk-action page, and the bulk-message/export APIs so they all target the same set.
export function studentWhereFromParams(sp: RosterParams): Prisma.StudentWhereInput {
  const where: Prisma.StudentWhereInput = { deletedAt: null };
  const and: Prisma.StudentWhereInput[] = [];
  if (sp.stage && sp.stageStatus) {
    // stage + a specific four-state status (cleared / appeared-failed / not-appeared)
    const sw = stageStatusWhere(sp.stage, sp.stageStatus);
    if (sw) and.push(sw);
  } else if (sp.stage) {
    where.currentStage = sp.stage; // students currently AT this stage
  }
  if (sp.bucket) where.bucket = { name: sp.bucket };
  if (sp.yog && /^\d{4}$/.test(sp.yog)) where.yearOfGraduation = Number(sp.yog);
  if (sp.q) and.push({ OR: [{ name: { contains: sp.q } }, { email: { contains: sp.q } }, { externalRef: { contains: sp.q } }] });
  if (sp.outcome) {
    const ow = outcomeWhere(sp.outcome);
    if (ow) and.push(ow);
  }
  if (sp.progress) {
    const pw = progressWhere(sp.progress);
    if (pw) and.push(pw);
  }
  if (and.length) where.AND = and;
  return where;
}

// Human description of the active filter (for headers / confirmation).
export function describeFilter(sp: RosterParams): string {
  const parts: string[] = [];
  if (sp.bucket) parts.push(`Bucket ${sp.bucket}`);
  if (sp.stage) parts.push(sp.stage);
  if (sp.outcome) parts.push(OUTCOME_LABELS[sp.outcome] ?? sp.outcome);
  if (sp.progress) parts.push(PROGRESS_LABELS[sp.progress] ?? sp.progress);
  if (sp.yog) parts.push(`YOG ${sp.yog}`);
  if (sp.q) parts.push(`“${sp.q}”`);
  return parts.length ? parts.join(" · ") : "all students";
}

export function rosterQuery(sp: RosterParams): string {
  const u = new URLSearchParams();
  if (sp.q) u.set("q", sp.q);
  if (sp.stage) u.set("stage", sp.stage);
  if (sp.stageStatus) u.set("stageStatus", sp.stageStatus);
  if (sp.bucket) u.set("bucket", sp.bucket);
  if (sp.yog) u.set("yog", sp.yog);
  if (sp.outcome) u.set("outcome", sp.outcome);
  if (sp.progress) u.set("progress", sp.progress);
  return u.toString();
}
