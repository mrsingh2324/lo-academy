import type { Prisma } from "@prisma/client";

export type RosterParams = { stage?: string; bucket?: string; q?: string; yog?: string };

// Single source of truth for the roster filter — used by the roster list, the
// bulk-action page, and the bulk-message API so they all target the same set.
export function studentWhereFromParams(sp: RosterParams): Prisma.StudentWhereInput {
  const where: Prisma.StudentWhereInput = { deletedAt: null };
  if (sp.stage) where.currentStage = sp.stage;
  if (sp.bucket) where.bucket = { name: sp.bucket };
  if (sp.yog && /^\d{4}$/.test(sp.yog)) where.yearOfGraduation = Number(sp.yog);
  if (sp.q) where.OR = [{ name: { contains: sp.q } }, { email: { contains: sp.q } }, { externalRef: { contains: sp.q } }];
  return where;
}

// Human description of the active filter (for headers / confirmation).
export function describeFilter(sp: RosterParams): string {
  const parts: string[] = [];
  if (sp.bucket) parts.push(`Bucket ${sp.bucket}`);
  if (sp.stage) parts.push(sp.stage);
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
  return u.toString();
}
