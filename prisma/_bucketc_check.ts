import { prisma } from "../src/lib/prisma";

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
async function csv(gid: string): Promise<string[][]> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/1_pez9ph2cUZ-UGyPpbRuDHgAD6atFRdJvX8tvEoNUvk/export?format=csv&gid=${gid}`);
  if (!res.ok) throw new Error(`gid ${gid}: HTTP ${res.status}`);
  return parseCSV(await res.text());
}
const isUid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test((s ?? "").trim());

async function main() {
  const TABS: Record<string, string> = {
    "Not Attempted/Offline Cleared": "1125835503",
    "TR - Attended": "35027949",
    "TR - Cleared": "385567428",
    "TR - Rejected": "0",
    "TR - Rejected Transcripts": "1077599267",
  };
  const tabUids: Record<string, string[]> = {};
  for (const [name, gid] of Object.entries(TABS)) {
    const rows = await csv(gid);
    // UID is in col 0 for most tabs; scan all cells of each row for a UID to be safe
    const uids: string[] = [];
    for (const r of rows) {
      const u = (r.find((c) => isUid(c)) ?? "").trim();
      if (u) uids.push(u);
    }
    tabUids[name] = uids;
    console.log(`${name.padEnd(34)} rows=${(rows.length - 1).toString().padStart(4)}  UIDs=${uids.length.toString().padStart(4)}  distinct=${new Set(uids).size}`);
  }

  // Reconcile against DB Bucket C
  const cStudents = await prisma.student.findMany({
    where: { deletedAt: null, bucket: { name: "C" } },
    select: { externalRef: true, name: true, currentStage: true, currentStatus: true, placementProfile: true },
  });
  const cByRef = new Map(cStudents.map((s) => [s.externalRef, s]));
  console.log(`\nDB Bucket C total: ${cStudents.length}`);
  const stage: Record<string, number> = {};
  for (const s of cStudents) stage[s.currentStage] = (stage[s.currentStage] || 0) + 1;
  console.log("DB Bucket C by currentStage:", stage);

  const all = new Set<string>();
  Object.values(tabUids).forEach((arr) => arr.forEach((u) => all.add(u)));
  console.log(`\nUnion of all UIDs in Bucket C sheet: ${all.size}`);
  const inSheetNotC: string[] = [];
  const cleared = new Set(tabUids["TR - Cleared"]);
  const rejected = new Set(tabUids["TR - Rejected"]);
  const notAttempted = new Set(tabUids["Not Attempted/Offline Cleared"]);
  const attended = new Set(tabUids["TR - Attended"]);

  // For each sheet UID, see DB bucket + stage
  let matched = 0, notInDb = 0, notBucketC = 0;
  const mismatches: string[] = [];
  for (const u of all) {
    const s = cByRef.get(u);
    if (!s) {
      // is it in DB at all but different bucket?
      const any = await prisma.student.findUnique({ where: { externalRef: u }, select: { name: true, bucket: { select: { name: true } }, currentStage: true } });
      if (!any) { notInDb++; }
      else { notBucketC++; inSheetNotC.push(`${u} ${any.name} → DB bucket ${any.bucket?.name ?? "none"} / ${any.currentStage}`); }
      continue;
    }
    matched++;
  }
  console.log(`\nSheet UID → DB: matched-as-C=${matched}, in-DB-but-not-bucketC=${notBucketC}, not-in-DB=${notInDb}`);

  // Cross-tab overlaps (a UID should ideally be in exactly one outcome tab)
  console.log(`\nCross-tab overlaps (same UID in multiple outcome tabs):`);
  const outcomeTabs = ["Not Attempted/Offline Cleared", "TR - Attended", "TR - Cleared", "TR - Rejected"];
  const seen: Record<string, string[]> = {};
  for (const t of outcomeTabs) for (const u of new Set(tabUids[t])) (seen[u] ??= []).push(t);
  const dups = Object.entries(seen).filter(([, ts]) => ts.length > 1);
  console.log(`  ${dups.length} UIDs in >1 tab`);
  dups.slice(0, 15).forEach(([u, ts]) => console.log(`   ${u}: ${ts.join(" + ")} (${cByRef.get(u)?.name ?? "?"})`));

  // TR-Cleared (= Bucket C placement pool per this sheet) vs DB
  console.log(`\nTR-Cleared tab (Bucket C pool): ${cleared.size} distinct`);
  let clearedInDbPool = 0, clearedNotPool: string[] = [];
  for (const u of cleared) {
    const s = cByRef.get(u);
    if (s?.currentStage === "placement_pool") clearedInDbPool++;
    else clearedNotPool.push(`${u} ${s?.name ?? "?"} → DB stage ${s?.currentStage ?? "NOT-IN-C"}`);
  }
  console.log(`  of which DB currentStage=placement_pool: ${clearedInDbPool}`);
  console.log(`  cleared-in-sheet but NOT pool in DB: ${clearedNotPool.length}`);
  clearedNotPool.slice(0, 25).forEach((x) => console.log(`    ${x}`));

  // Sanity: do tab sizes add up?
  console.log(`\nTab arithmetic: notAttempted ${notAttempted.size} + attended ${attended.size} = ${notAttempted.size + attended.size}`);
  console.log(`  (attended should ~= cleared ${cleared.size} + rejected ${rejected.size} = ${cleared.size + rejected.size})`);
}
main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
