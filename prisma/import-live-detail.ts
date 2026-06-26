/**
 * Live detail import (PASS 2) — subject/marks-level interview data per bucket.
 *
 *   Bucket A  → TR1 (Audit & Eval R1) + TR2 (Audit & Eval R2)
 *   Bucket B  → TR1 (Audit & Eval)         [TR2 tab still sparse]
 *   Bucket C  → single TR (Eval & Audit)
 *
 * For each interviewed candidate it: records appearance, the per-subject ratings
 * + remarks (stored on StageAttempt.details), the 70% clearance (with the sheet's
 * Moved/Shortlisted/Final-Status as a CROSS-CHECK → disagreement → Reconciliation),
 * then recomputes the student's current stage from their attempt results.
 *
 * Run AFTER import-live-tracking.ts:  npx tsx prisma/import-live-detail.ts
 */
import { prisma } from "../src/lib/prisma";
import type { Prisma } from "@prisma/client";

function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let f = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}
async function csv(id: string, gid: string): Promise<string[][]> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`);
  if (!res.ok) throw new Error(`fetch ${id}/${gid}: HTTP ${res.status}`);
  return parseCSV(await res.text());
}
const clean = (v: unknown) => { const s = String(v ?? "").trim(); return !s || s === "#REF!" || s === "#N/A" ? "" : s; };
const num = (v: unknown) => { const s = clean(v); const n = Number(s); return s !== "" && Number.isFinite(n) ? n : null; };
const findHeaderRow = (a: string[][]) => { for (let i = 0; i < Math.min(6, a.length); i++) if ((a[i] || []).some((c) => /candidate id|candidate uid/i.test(String(c)))) return i; return 0; };
const col = (H: string[], re: RegExp) => H.findIndex((h) => re.test(h.replace(/\s+/g, " ")));

const A_ID = "1OjXl7ZWAonvze01vdCvPJAehppryJhZQYPweL41n2Co";
const B_ID = "1UZPCLCp0AxvkygzezeYGk8NkDj4WbPLhpp1LwE_ZgQU";
const C_ID = "1SQQQz2bmxrNlBDO3dNFco92_yp3AzvzQe-271kSu-0Y";

type DetailRec = {
  appeared: true; cleared: boolean | null; score: number | null; finalStatus: string;
  advanceSignal: string; subjects: Record<string, string>;
};
type StageMap = Map<string, DetailRec>; // uid -> rec

// Extract a {uid -> DetailRec} map for a tab given a column spec.
function extract(a: string[][], spec: {
  subjects: [string, RegExp][]; score?: RegExp; clearedFrom: (row: string[], H: string[]) => boolean | null;
  finalStatus?: RegExp; advance?: RegExp;
}): StageMap {
  const hr = findHeaderRow(a); const H = (a[hr] || []).map((c) => String(c).trim());
  const idIdx = col(H, /candidate id|candidate uid/i);
  const m: StageMap = new Map();
  for (const row of a.slice(hr + 1)) {
    const uid = clean(row[idIdx]); if (!uid) continue;
    const subjects: Record<string, string> = {};
    for (const [label, re] of spec.subjects) { const i = col(H, re); if (i >= 0 && clean(row[i])) subjects[label] = clean(row[i]); }
    const fsI = spec.finalStatus ? col(H, spec.finalStatus) : -1;
    const advI = spec.advance ? col(H, spec.advance) : -1;
    const scI = spec.score ? col(H, spec.score) : -1;
    m.set(uid, {
      appeared: true,
      cleared: spec.clearedFrom(row, H),
      score: scI >= 0 ? num(row[scI]) : null,
      finalStatus: fsI >= 0 ? clean(row[fsI]) : "",
      advanceSignal: advI >= 0 ? clean(row[advI]) : "",
      subjects,
    });
  }
  return m;
}

const PIPE: Record<string, string[]> = { A: ["nxtmock", "tr1", "tr2"], B: ["dev_test", "tr1", "tr2"], C: ["tr1"], D: [] };

async function main() {
  // ---- Bucket A ----
  const aTr1Raw = await csv(A_ID, "531396843");
  const aTr1 = extract(aTr1Raw, {
    subjects: [["Communication", /^communication/i], ["Problem 1 — Problem Solving", /problem 1.*problem solving/i],
      ["Problem 1 — Code Impl", /problem 1.*code impl/i], ["Problem 2 — Problem Solving", /problem 2.*problem solving/i],
      ["Problem 2 — Code Impl", /problem 2.*code impl/i], ["DSA Theory", /dsa theory/i], ["Core CS Theory", /core cs theory/i],
      ["DSA MCQs", /dsa mcqs/i], ["Overall Comments", /overall comments/i]],
    score: /total score.*100/i, finalStatus: /final status/i, advance: /moved to/i,
    clearedFrom: (row, H) => { const t = num(row[col(H, /total score.*100/i)]); if (t != null) return t >= 70; const fs = clean(row[col(H, /final status/i)]).toLowerCase(); return /hire/.test(fs) ? true : /reject/.test(fs) ? false : null; },
  });
  const aTr2Raw = await csv(A_ID, "1537594259");
  const aTr2 = extract(aTr2Raw, {
    subjects: [["Soft Skills", /soft skills/i], ["Project", /^project/i], ["Frontend", /frontend/i], ["Backend", /backend/i],
      ["Internship", /internship/i], ["AI Knowledge", /ai knowledge/i], ["Overall Remarks", /overall remarks/i]],
    score: /overall score/i, finalStatus: /final verdict/i, advance: /placement pool eligibility \(after/i,
    clearedFrom: (row, H) => { const p = clean(row[col(H, /placement pool eligibility \(after/i)]).toLowerCase(); if (/shortlist/.test(p)) return true; if (/reject/.test(p)) return false; return null; },
  });

  // ---- Bucket B (TR1) ----
  const bTr1Raw = await csv(B_ID, "1215698362");
  const bTr1 = extract(bTr1Raw, {
    subjects: [["Part 1 — Take-Home Drill-Down", /take-home/i], ["Part 2 — Frontend Conceptual", /frontend conceptual/i],
      ["Part 3 — React Live Coding", /react live coding/i], ["Overall Summary", /overall summary/i], ["Remarks", /^remarks/i]],
    finalStatus: /auditing status|interview status/i,
    clearedFrom: () => null, // keep core's 70% (/15) decision; just enrich + mark appeared
  });

  // ---- Bucket C (single TR) ----
  const cRaw = await csv(C_ID, "1658050456");
  const cTr = extract(cRaw, {
    subjects: [["Part 1 — Resume Drill-Down", /resume-based drill-down/i], ["Part 2 — Problem Solving", /part 2.*problem solving/i],
      ["Overall Summary", /overall summary/i], ["Remarks", /^remarks/i]],
    finalStatus: /final status/i,
    clearedFrom: () => null, // keep core's 70% (/10) decision
  });

  const detail: Record<string, { tr1?: StageMap; tr2?: StageMap }> = {
    A: { tr1: aTr1, tr2: aTr2 }, B: { tr1: bTr1 }, C: { tr1: cTr },
  };
  console.log(`detail rows — A.tr1=${aTr1.size} A.tr2=${aTr2.size} B.tr1=${bTr1.size} C.tr1=${cTr.size}`);

  await prisma.reconciliationItem.deleteMany({ where: { source: "live_detail" } });

  // Union of all UIDs that appear in any detail tab.
  const uids = new Set<string>();
  for (const b of Object.values(detail)) for (const sm of Object.values(b)) for (const k of sm!.keys()) uids.add(k);

  const students = await prisma.student.findMany({
    where: { externalRef: { in: [...uids] } },
    include: { attempts: true, bucket: true },
  });
  const byRef = new Map(students.map((s) => [s.externalRef, s]));

  let enriched = 0, advanced = 0, reconCount = 0, missing = 0;

  async function processUid(uid: string) {
    const student = byRef.get(uid);
    if (!student) { missing++; return; }
    const bucket = student.bucket?.name ?? null;
    const recs: Record<string, DetailRec> = {};
    for (const [stage, sm] of Object.entries(detail[bucket ?? ""] ?? {})) { const r = sm!.get(uid); if (r) recs[stage] = r; }
    if (!Object.keys(recs).length) return;

    for (const [stage, rec] of Object.entries(recs)) {
      const existing = student.attempts.find((a) => a.stage === stage);
      // clearance: detail decides when it has an opinion; else keep the existing (core/70%) result.
      const clearedDetail = rec.cleared;
      const finalResult: "pass" | "fail" | "pending" =
        clearedDetail === true ? "pass" : clearedDetail === false ? "fail" : (existing?.result as "pass" | "fail" | "pending") ?? "pending";
      const status = finalResult === "pass" ? "passed" : finalResult === "fail" ? "failed" : "evaluated";
      const details = { ...(existing?.details as object ?? {}), appearedViaDetail: true, subjects: rec.subjects, finalStatus: rec.finalStatus, advanceSignal: rec.advanceSignal, cleared70: clearedDetail } as Prisma.InputJsonValue;
      await prisma.stageAttempt.upsert({
        where: { studentId_stage_attemptNumber: { studentId: student.id, stage, attemptNumber: 1 } },
        create: { studentId: student.id, stage, attemptNumber: 1, status, result: finalResult, score: rec.score ?? undefined, outcome: rec.finalStatus || undefined, details },
        update: { status, result: finalResult, score: rec.score ?? undefined, outcome: rec.finalStatus || undefined, details },
      });
      enriched++;

      // cross-check 70% vs the sheet's advance/final wording
      const signal = `${rec.advanceSignal} ${rec.finalStatus}`.toLowerCase();
      const signalPass = /moved|shortlist|hire|cleared|select/.test(signal) && !/not |reject/.test(signal);
      if (clearedDetail != null && /moved|shortlist|hire|reject|cleared/.test(signal) && clearedDetail !== signalPass) {
        reconCount++;
        await prisma.reconciliationItem.create({
          data: { source: "live_detail", bucket: bucket ?? undefined, kind: "score_vs_status", uid, name: student.name,
            detail: { stage, cleared70: clearedDetail, sheetSignal: `${rec.advanceSignal} / ${rec.finalStatus}`.trim() } as Prisma.InputJsonValue },
        });
      }
    }

    // recompute current stage from attempt results along the bucket pipeline
    const fresh = await prisma.stageAttempt.findMany({ where: { studentId: student.id } });
    const passOf = (st: string) => fresh.find((a) => a.stage === st)?.result === "pass";
    const pipe = PIPE[bucket ?? ""] ?? [];
    let cur = "placement_pool";
    for (const st of pipe) {
      if (st === "nxtmock" && (student.cycle ?? 0) < 5) continue; // NxtMock only cycle 5+
      if (!passOf(st)) { cur = st; break; }
    }
    if (bucket === "D" || !pipe.length) cur = "rejected";
    if (cur !== student.currentStage) {
      await prisma.student.update({ where: { id: student.id }, data: { currentStage: cur, ...(cur === "placement_pool" ? { finalPortalRedirectedAt: new Date() } : {}) } });
      advanced++;
    }
  }

  const list = [...uids];
  const CONC = 24;
  for (let i = 0; i < list.length; i += CONC) {
    await Promise.all(list.slice(i, i + CONC).map((u) => processUid(u).catch((e) => console.error("uid", u, (e as Error).message))));
    process.stdout.write(`  …${Math.min(i + CONC, list.length)}/${list.length}\r`);
  }

  console.log(`\nDetail import complete. attempts enriched=${enriched} · stage recomputed=${advanced} · reconcile=${reconCount} · uids not in roster=${missing}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
