import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getActor } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { firstStageForBucket } from "@/lib/enums";
import { nextWeekendSlots } from "@/lib/slots";
import type { Prisma } from "@prisma/client";

// Minimal robust CSV parser (handles quoted fields, commas, newlines).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const find = (hdr: string[], re: RegExp) => hdr.findIndex((h) => re.test(h.trim().toLowerCase()));
function bucketLetter(raw: string): "A" | "B" | "C" | "D" {
  const m = (raw || "").match(/bucket\s*-?\s*([abc])/i);
  if (m) return m[1].toUpperCase() as "A" | "B" | "C";
  return "D"; // "Offline Not Qualified" / anything else
}

/**
 * Ops uploads a sheet of newly offline-qualified students. New students are
 * onboarded additively (idempotent on externalRef — re-upload never dupes),
 * placed in their bucket at the bucket's first stage. Bulk insert for speed.
 */
export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor || !["ops", "admin"].includes(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { csv } = await req.json();
  if (typeof csv !== "string" || !csv.trim()) return NextResponse.json({ error: "Empty file" }, { status: 400 });

  const grid = parseCsv(csv).filter((r) => r.some((c) => c.trim()));
  if (grid.length < 2) return NextResponse.json({ error: "No data rows" }, { status: 400 });

  const hdr = grid[0];
  const idIdx = find(hdr, /user id|candidate id|uid|^id$|_id/);
  const nameIdx = find(hdr, /name/);
  const yogIdx = find(hdr, /yog|graduation/);
  const bucketIdx = find(hdr, /bucket/);
  if (idIdx < 0 || bucketIdx < 0) {
    return NextResponse.json({ error: "Could not find an ID column and a bucket column in the sheet header." }, { status: 400 });
  }

  // parse + dedupe by ref
  const seen = new Set<string>();
  const rows: { ref: string; name: string; yog: number | null; letter: "A" | "B" | "C" | "D" }[] = [];
  for (const r of grid.slice(1)) {
    const ref = (r[idIdx] ?? "").trim();
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    const yogRaw = yogIdx >= 0 ? (r[yogIdx] ?? "").trim() : "";
    rows.push({
      ref,
      name: (nameIdx >= 0 ? r[nameIdx] : "")?.trim() || "(unnamed)",
      yog: /^\d{4}$/.test(yogRaw) ? Number(yogRaw) : null,
      letter: bucketLetter(r[bucketIdx] ?? ""),
    });
  }

  // skip students already in the DB (idempotent)
  const existing = new Set(
    (await prisma.student.findMany({ where: { externalRef: { in: rows.map((r) => r.ref) } }, select: { externalRef: true } }))
      .map((s) => s.externalRef)
  );
  const fresh = rows.filter((r) => !existing.has(r.ref));

  // ensure buckets exist
  const buckets: Record<string, string> = {};
  for (const [name, desc] of [["A", "Offline Qualified — A"], ["B", "Offline Qualified — B"], ["C", "Offline Qualified — C"], ["D", "Offline Not Qualified"]]) {
    const b = await prisma.bucket.upsert({ where: { name }, create: { name, description: desc }, update: {} });
    buckets[name] = b.id;
  }

  const now = new Date();
  const slots = nextWeekendSlots();
  const studentRows: Prisma.StudentCreateManyInput[] = [];
  const attemptRows: Prisma.StageAttemptCreateManyInput[] = [];
  const byBucket: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };

  for (const r of fresh) {
    const first = firstStageForBucket(r.letter); // Nxtmock=A, Dev test=B, TR1=C, null=D
    const sid = randomUUID();
    const aid = first ? randomUUID() : null;
    byBucket[r.letter]++;
    studentRows.push({
      id: sid,
      externalRef: r.ref,
      name: r.name,
      email: `${r.ref}@placeholder.invalid`,
      yearOfGraduation: r.yog,
      bucketId: buckets[r.letter],
      offlineClearedAt: first ? now : null,
      currentStage: first ?? "rejected",
      currentStatus: first ? "availability_requested" : "not_qualified",
      currentAttemptId: aid,
    });
    if (first && aid) {
      attemptRows.push({ id: aid, studentId: sid, stage: first, attemptNumber: 1, status: "availability_requested", availabilityOptions: slots as unknown as Prisma.InputJsonValue });
    }
  }

  for (let i = 0; i < studentRows.length; i += 500) await prisma.student.createMany({ data: studentRows.slice(i, i + 500) });
  for (let i = 0; i < attemptRows.length; i += 500) await prisma.stageAttempt.createMany({ data: attemptRows.slice(i, i + 500) });

  await audit(prisma, { entity: "intake", entityId: "upload", actorId: actor.id, action: "bulk_upload", after: { received: rows.length, created: fresh.length, skipped: rows.length - fresh.length, byBucket } });

  return NextResponse.json({ received: rows.length, created: fresh.length, skipped: rows.length - fresh.length, byBucket });
}
