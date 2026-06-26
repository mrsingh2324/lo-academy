/**
 * Placement-pool import — the "Main" tab of the post-assessment Placement Pool
 * sheet (students who reached the pool, enriched with placement OUTCOMES that the
 * assessment pipeline doesn't track): eligible role, latest placement status,
 * company / CTC / placed-through, job-board access, job preferences, expected CTC,
 * and the TR1/TR2 recording + latest-resume links.
 *
 * Stores the lossless record on Student.placementProfile (Json) and back-fills
 * Student.resumeUrl when empty. Matches existing students by externalRef (UID) —
 * every Main UID already exists in the roster, so this is ENRICH-ONLY (no creates).
 *
 * Idempotent: re-running overwrites placementProfile from the sheet.
 *
 * Run: npx tsx prisma/import-placement-pool.ts
 */
import { prisma } from "../src/lib/prisma";
import type { Prisma } from "@prisma/client";

const SHEET = { id: "1aoNq78dvTXZUY0xifboz9kAhOlgk_-wghZLtiOGcbtA", gid: "237289902" }; // "Main"

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
const clean = (v: unknown) => {
  const s = String(v ?? "").trim();
  return !s || s === "#REF!" || s === "#N/A" || s === "#REF\\!" ? "" : s;
};
// first non-empty among several column indices (the Main tab repeats Company/CTC/Resume)
const first = (r: string[], ...idx: number[]) => { for (const i of idx) { const v = clean(r[i]); if (v) return v; } return ""; };

async function main() {
  const rows = await csv(SHEET.id, SHEET.gid);
  const body = rows.slice(1).filter((r) => /^[0-9a-f]{8}-/.test(clean(r[0])));
  console.log(`Main tab rows with UID: ${body.length}`);

  // Build the placement record per UID (last row wins on duplicate UIDs).
  const profiles = new Map<string, Prisma.InputJsonValue & { resume?: string }>();
  const resumeByUid = new Map<string, string>();
  for (const r of body) {
    const uid = clean(r[0]);
    const resume = first(r, 21, 28, 29);
    const profile = {
      eligibleRole: clean(r[8]) || null,
      offlineCycle: clean(r[4]) || null,
      studentAddedDate: clean(r[7]) || null,
      gender: clean(r[18]) || null,
      college: clean(r[15]) || null,
      bachelorsDegree: clean(r[16]) || null,
      bachelorsDepartment: clean(r[17]) || null,
      scores: {
        overall: clean(r[9]) || null,
        codingExam: clean(r[10]) || null,
        dsaMcqs: clean(r[11]) || null,
        technicalMcqs: clean(r[12]) || null,
        aptitude: clean(r[13]) || null,
        coreCsSubjects: clean(r[14]) || null,
      },
      recordings: {
        tr1: clean(r[19]) || null,
        tr2: clean(r[20]) || null,
      },
      resumeUrl: resume || null,
      placedResumeUrl: clean(r[29]) || null,
      jobBoardAccessStatus: clean(r[22]) || null,
      latestPlacementStatus: clean(r[23]) || null,
      company: first(r, 24, 34) || null,
      ctc: first(r, 25, 36) || null,
      placedThrough: clean(r[26]) || null,
      postOfflinePlacementStatus: clean(r[27]) || null,
      jobOpportunityType: clean(r[30]) || null,
      preferredJobLocation: clean(r[31]) || null,
      expectedCtcThroughNxtwave: clean(r[32]) || null,
      currentPlacementStatus: clean(r[33]) || null,
      jobRole: clean(r[35]) || null,
      jobType: clean(r[37]) || null,
      expectingOpportunityFromNxtwave: clean(r[38]) || null,
      source: "placement_pool_main",
    };
    profiles.set(uid, profile as Prisma.InputJsonValue & { resume?: string });
    if (resume) resumeByUid.set(uid, resume);
  }
  console.log(`distinct UIDs: ${profiles.size}`);

  const uids = [...profiles.keys()];
  const existing = await prisma.student.findMany({
    where: { externalRef: { in: uids } },
    select: { id: true, externalRef: true, resumeUrl: true },
  });
  const byRef = new Map(existing.map((s) => [s.externalRef, s]));

  let updated = 0, notFound = 0, resumeFilled = 0;
  async function processUid(uid: string) {
    const s = byRef.get(uid);
    if (!s) { notFound++; console.warn("  not in roster:", uid); return; }
    const resume = resumeByUid.get(uid);
    const fillResume = resume && !s.resumeUrl;
    await prisma.student.update({
      where: { id: s.id },
      data: {
        placementProfile: profiles.get(uid)!,
        ...(fillResume ? { resumeUrl: resume } : {}),
      },
    });
    if (fillResume) resumeFilled++;
    updated++;
  }

  const CONC = 24;
  for (let i = 0; i < uids.length; i += CONC) {
    await Promise.all(uids.slice(i, i + CONC).map((u) => processUid(u).catch((e) => console.error("uid", u, (e as Error).message))));
    process.stdout.write(`  …${Math.min(i + CONC, uids.length)}/${uids.length}\r`);
  }

  console.log(`\nPlacement-pool import complete.`);
  console.log(`  students enriched: ${updated}`);
  console.log(`  resume back-filled: ${resumeFilled}`);
  console.log(`  UIDs not in roster: ${notFound}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
