/**
 * Live tracking import (CORE) — reads the tracking sheets directly (no map_*.py).
 *
 *   INTAKE "Main"  → every candidate: effective (upgraded) bucket, cycle, YOG,
 *                    stage summary, NxtMock/Web/React/Bucket-B status, TR scores.
 *   CONTACT sheet  → UID → phone / email.
 *
 * Applies the team's rules (see PLACEMENT_RULES.md): latest/upgraded bucket
 * decides the path; NxtMock only for Bucket A from cycle 5; TR cleared at 70%
 * (TR1 ≥10.5/15 or ≥7/10, TR2 ≥7/10); Bucket D = offline-not-qualified.
 *
 * Idempotent: students upserted on externalRef, attempts upserted on
 * (studentId, stage, attemptNumber) — existing reports/feedback are preserved.
 * Subject-level marks are layered on by import-live-detail.ts (a second pass).
 *
 * Run: npx tsx prisma/import-live-tracking.ts
 */
import { prisma } from "../src/lib/prisma";
import type { Prisma } from "@prisma/client";

const INTAKE = { id: "1i_-lkNAzgYaDhsNte6p3V7y7AVbZ8idac-R8LH_OXoA", gid: "0" };
const CONTACT_ID = "13UhvwUiitFzyxqPjx8XgrB1Va6np7wp56bBwRu883Ps";
const CONTACT_GIDS = ["551739889", "644580170", "291801740", "366657395"];

// ---- tiny CSV parser (handles quotes, embedded commas/newlines) ----
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
async function csv(id: string, gid: string): Promise<string[][]> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`);
  if (!res.ok) throw new Error(`fetch ${id} gid ${gid}: HTTP ${res.status}`);
  return parseCSV(await res.text());
}

const clean = (v: unknown) => {
  const s = String(v ?? "").trim();
  return !s || s === "#REF!" || s === "#N/A" ? "" : s;
};
const num = (v: unknown) => {
  const s = clean(v);
  const n = Number(s);
  return s !== "" && Number.isFinite(n) ? n : null;
};
const bucketLabel = (v: unknown) => (String(v).match(/\b([A-D])\b/i)?.[1]?.toUpperCase()) ?? null;
const normPhone = (v: unknown) => String(v ?? "").replace(/\D+/g, "");

// Map our stage names → assessment-portal's currentStage vocabulary.
const STAGE_TO_PORTAL: Record<string, string> = {
  NxtMock: "nxtmock",
  "Development Assessment": "dev_test",
  TR1: "tr1",
  TR: "tr1",
  TR2: "tr2",
  "Placement Pool": "placement_pool",
  "Offline Not Qualified": "rejected",
};

interface Derived {
  effectiveBucket: string | null;
  cycleNum: number | null;
  stage: string;
  tr1Cleared: boolean;
  tr2Cleared: boolean;
  reconcile: string[];
}

// 70% engine over one INTAKE row (real headers on row index 1; data from row 2).
function derive(r: string[]): Derived {
  const cycleNum = parseInt(clean(r[3]).match(/(\d+)/)?.[1] ?? "0", 10) || null;
  const baseBucket = bucketLabel(r[4]);
  const upgrades = [11, 10, 9, 8, 7, 6, 5].map((i) => bucketLabel(r[i])).filter(Boolean) as string[];
  const effectiveBucket = upgrades[0] ?? baseBucket;
  const notQualified = /not qualified/i.test(clean(r[23])) || effectiveBucket === "D";

  const nxtmock = clean(r[13]);
  const devStatus = clean(r[16]);
  const tr1_15 = num(r[20]);
  const tr1_10 = num(r[22]);
  const tr2_10 = num(r[21]);
  const tr1Cleared = (tr1_15 != null && tr1_15 >= 10.5) || (tr1_10 != null && tr1_10 >= 7);
  const tr2Cleared = tr2_10 != null && tr2_10 >= 7;

  const reconcile: string[] = [];
  if (tr1_15 != null && tr1_10 != null) reconcile.push("TR1 has both /15 and /10 scores");
  if (effectiveBucket === "B" && nxtmock) reconcile.push("Bucket B has NxtMock data");
  if (tr2_10 != null && tr2Cleared && !tr1Cleared) reconcile.push("Cleared TR2 without clearing TR1");

  let stage: string;
  if (notQualified) stage = "Offline Not Qualified";
  else if (effectiveBucket === "A") {
    if ((cycleNum ?? 0) >= 5 && nxtmock !== "Cleared" && nxtmock !== "NA") stage = "NxtMock";
    else if (!tr1Cleared) stage = "TR1";
    else if (!tr2Cleared) stage = "TR2";
    else stage = "Placement Pool";
  } else if (effectiveBucket === "B") {
    if (devStatus !== "Cleared") stage = "Development Assessment";
    else if (!tr1Cleared) stage = "TR1";
    else if (!tr2Cleared) stage = "TR2";
    else stage = "Placement Pool";
  } else if (effectiveBucket === "C") {
    stage = tr1Cleared ? "Placement Pool" : "TR";
  } else stage = "rejected";

  return { effectiveBucket, cycleNum, stage, tr1Cleared, tr2Cleared, reconcile };
}

async function buildContactMap(): Promise<Record<string, { phone: string; email: string }>> {
  const map: Record<string, { phone: string; email: string }> = {};
  for (const gid of CONTACT_GIDS) {
    let rows: string[][];
    try { rows = await csv(CONTACT_ID, gid); } catch { continue; }
    const H = (rows[0] ?? []).map((c) => c.toLowerCase().trim());
    const ui = H.findIndex((h) => ["user id", "uid", "candidate id"].includes(h));
    const pi = H.findIndex((h) => ["mobile number", "mobile", "phone", "number"].includes(h));
    const ei = H.findIndex((h) => ["email id", "email"].includes(h));
    if (ui < 0) continue;
    for (const r of rows.slice(1)) {
      const uid = clean(r[ui]);
      if (!uid) continue;
      const e = (map[uid] ??= { phone: "", email: "" });
      if (!e.phone && pi >= 0) e.phone = normPhone(r[pi]);
      if (!e.email && ei >= 0) e.email = clean(r[ei]).toLowerCase();
    }
  }
  return map;
}

// Upsert one attempt by (studentId, stage, attemptNumber) — preserves children.
async function upsertAttempt(studentId: string, stage: string, data: Prisma.StageAttemptUncheckedCreateInput) {
  await prisma.stageAttempt.upsert({
    where: { studentId_stage_attemptNumber: { studentId, stage, attemptNumber: 1 } },
    create: { ...data, studentId, stage, attemptNumber: 1 },
    update: { status: data.status, score: data.score, result: data.result, outcome: data.outcome, details: data.details },
  });
}

const attemptStatus = (cleared: boolean, hasScore: boolean, hasData: boolean) =>
  cleared ? "passed" : hasScore || hasData ? "evaluated" : "availability_requested";

async function main() {
  const [main, contact] = await Promise.all([csv(INTAKE.id, INTAKE.gid), buildContactMap()]);
  const body = main.slice(2).filter((r) => clean(r[0]));

  // Bucket id cache (upsert A/B/C/D once).
  const bucketId: Record<string, string> = {};
  for (const name of ["A", "B", "C", "D"]) {
    const b = await prisma.bucket.upsert({ where: { name }, create: { name }, update: {} });
    bucketId[name] = b.id;
  }

  await prisma.reconciliationItem.deleteMany({ where: { source: "live_tracking" } });

  const stageTally: Record<string, number> = {};
  const bucketTally: Record<string, number> = {};
  let created = 0, updated = 0, reconCount = 0, contactMissing = 0;

  async function processRow(r: string[]) {
    const uid = clean(r[0]);
    const d = derive(r);
    const c = contact[uid] ?? { phone: "", email: "" };
    if (!c.email) { contactMissing++; }
    const email = c.email || `${uid}@unknown.invalid`;
    const portalStage = STAGE_TO_PORTAL[d.stage] ?? "rejected";

    const existing = await prisma.student.findUnique({ where: { externalRef: uid } });
    const student = await prisma.student.upsert({
      where: { externalRef: uid },
      create: {
        externalRef: uid,
        name: clean(r[1]) || `Student ${uid.slice(0, 8)}`,
        email,
        phone: c.phone || null,
        yearOfGraduation: num(r[12]),
        cycle: d.cycleNum,
        bucketId: d.effectiveBucket ? bucketId[d.effectiveBucket] : null,
        offlineClearedAt: d.effectiveBucket && d.effectiveBucket !== "D" ? new Date() : null,
        currentStage: portalStage,
        currentStatus: portalStage === "rejected" ? "not_qualified" : portalStage === "placement_pool" ? "passed" : "availability_requested",
      },
      update: {
        name: clean(r[1]) || undefined,
        phone: c.phone || undefined,
        email: c.email || undefined,
        yearOfGraduation: num(r[12]) ?? undefined,
        cycle: d.cycleNum ?? undefined,
        bucketId: d.effectiveBucket ? bucketId[d.effectiveBucket] : undefined,
        currentStage: portalStage,
      },
    });
    existing ? updated++ : created++;
    stageTally[d.stage] = (stageTally[d.stage] || 0) + 1;
    if (d.effectiveBucket) bucketTally[d.effectiveBucket] = (bucketTally[d.effectiveBucket] || 0) + 1;

    // ---- attempts per effective bucket ----
    const b = d.effectiveBucket;
    if (b === "A" && (d.cycleNum ?? 0) >= 5 && clean(r[13])) {
      const cleared = clean(r[13]) === "Cleared";
      await upsertAttempt(student.id, "nxtmock", {
        studentId: student.id, stage: "nxtmock", status: attemptStatus(cleared, false, true),
        result: cleared ? "pass" : clean(r[13]) === "Not Cleared" ? "fail" : "pending",
        outcome: clean(r[13]) || null, details: { nxtmockStatus: clean(r[13]), cycle: d.cycleNum } as Prisma.InputJsonValue,
      });
    }
    if (b === "B") {
      const cleared = clean(r[16]) === "Cleared";
      await upsertAttempt(student.id, "dev_test", {
        studentId: student.id, stage: "dev_test", status: attemptStatus(cleared, false, !!clean(r[16])),
        result: cleared ? "pass" : clean(r[16]) === "Not Cleared" ? "fail" : "pending",
        outcome: clean(r[16]) || null,
        details: { webDeveloper: clean(r[14]), reactDeveloper: clean(r[15]), bucketBAssessmentStatus: clean(r[16]) } as Prisma.InputJsonValue,
      });
    }
    if (b === "A" || b === "B" || b === "C") {
      const tr1_15 = num(r[20]), tr1_10 = num(r[22]);
      const tr1Score = tr1_15 ?? tr1_10;
      if (tr1Score != null || clean(r[18])) {
        await upsertAttempt(student.id, "tr1", {
          studentId: student.id, stage: "tr1", status: attemptStatus(d.tr1Cleared, tr1Score != null, !!clean(r[18])),
          score: tr1Score ?? undefined, result: d.tr1Cleared ? "pass" : tr1Score != null ? "fail" : "pending",
          outcome: clean(r[18]) || null,
          details: { scoreOutOf15: tr1_15, scoreOutOf10: tr1_10, hireWording: clean(r[18]), cleared70: d.tr1Cleared } as Prisma.InputJsonValue,
        });
      }
      if (b !== "C") {
        const tr2_10 = num(r[21]);
        if (tr2_10 != null || clean(r[19])) {
          await upsertAttempt(student.id, "tr2", {
            studentId: student.id, stage: "tr2", status: attemptStatus(d.tr2Cleared, tr2_10 != null, !!clean(r[19])),
            score: tr2_10 ?? undefined, result: d.tr2Cleared ? "pass" : tr2_10 != null ? "fail" : "pending",
            outcome: clean(r[19]) || null,
            details: { scoreOutOf10: tr2_10, hireWording: clean(r[19]), cleared70: d.tr2Cleared } as Prisma.InputJsonValue,
          });
        }
      }
    }

    for (const reason of d.reconcile) {
      reconCount++;
      await prisma.reconciliationItem.create({
        data: { source: "live_tracking", bucket: d.effectiveBucket ?? undefined, kind: "rule_conflict", uid, name: student.name,
          detail: { reason } as Prisma.InputJsonValue },
      });
    }
  }

  // Run in concurrent batches — remote Postgres latency dominates, so ~24-wide
  // parallelism turns a ~2hr serial run into a couple of minutes.
  const CONC = 24;
  for (let i = 0; i < body.length; i += CONC) {
    await Promise.all(
      body.slice(i, i + CONC).map((r) => processRow(r).catch((e) => console.error("row error:", (e as Error).message)))
    );
    process.stdout.write(`  …${Math.min(i + CONC, body.length)}/${body.length}\r`);
  }

  console.log(`\nLive tracking import complete.`);
  console.log(`  students: ${body.length}  (created ${created}, updated ${updated})`);
  console.log(`  contact missing email: ${contactMissing}`);
  console.log(`  by bucket:`, bucketTally);
  console.log(`  by stage:`, stageTally);
  console.log(`  reconciliation flagged: ${reconCount}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
