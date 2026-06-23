import type { Prisma } from "@prisma/client";

export type RosterParams = { stage?: string; bucket?: string; q?: string; yog?: string; outcome?: string };

// Outcome buckets: a high-level cleared / failed / in-process split.
export const OUTCOMES = ["cleared", "failed", "in_process"] as const;
export const OUTCOME_LABELS: Record<string, string> = { cleared: "Cleared", failed: "Failed", in_process: "In process" };

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
  if (sp.stage) where.currentStage = sp.stage;
  if (sp.bucket) where.bucket = { name: sp.bucket };
  if (sp.yog && /^\d{4}$/.test(sp.yog)) where.yearOfGraduation = Number(sp.yog);
  if (sp.q) and.push({ OR: [{ name: { contains: sp.q } }, { email: { contains: sp.q } }, { externalRef: { contains: sp.q } }] });
  if (sp.outcome) {
    const ow = outcomeWhere(sp.outcome);
    if (ow) and.push(ow);
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
  if (sp.yog) parts.push(`YOG ${sp.yog}`);
  if (sp.q) parts.push(`“${sp.q}”`);
  return parts.length ? parts.join(" · ") : "all students";
}

export function rosterQuery(sp: RosterParams): string {
  const u = new URLSearchParams();
  if (sp.q) u.set("q", sp.q);
  if (sp.stage) u.set("stage", sp.stage);
  if (sp.bucket) u.set("bucket", sp.bucket);
  if (sp.yog) u.set("yog", sp.yog);
  if (sp.outcome) u.set("outcome", sp.outcome);
  return u.toString();
}
