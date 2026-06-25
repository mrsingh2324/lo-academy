# Placement / Assessment — Domain Rules (source of truth)

These are the real-world rules that govern how a candidate moves through the
assessment funnel. They were captured from the operations team and reconciled
against the live tracking sheets. The state machine (`src/lib/stateMachine.ts`),
pipelines (`src/lib/enums.ts`), and import scripts (`prisma/import-*.ts`) should
all conform to this document.

---

## 1. Buckets & routing

Every candidate who **attempted the offline assessment** is in the funnel, in one
of four buckets:

| Bucket | Meaning | Pipeline |
|--------|---------|----------|
| **A** | Offline-qualified, top tier | NxtMock → TR1 → TR2 → Placement Pool |
| **B** | Offline-qualified | Development Assessment → TR1 → TR2 → Placement Pool |
| **C** | Offline-qualified | Single TR → Placement Pool |
| **D** | **Offline NOT qualified** (attempted, failed) | none — terminal in funnel |

- **Routing uses the latest / "upgraded" bucket**, not the original one. Buckets
  are re-evaluated across cycles; the most recent upgraded bucket is the
  candidate's effective bucket and decides the rest of the path.
- If the sheet's "best/Students bucket" cell is **blank**, the plain bucket value
  is the final bucket.
- **Bucket D is part of the funnel** (shown in the roster) but has no further
  stages — they stop at "Offline Not Qualified".

## 2. Cycle & NxtMock

- Each candidate has a **cycle** number (cohort). Cycles run 1…11+.
- **NxtMock applies only from cycle 5 onward.** Before cycle 5 there was no
  NxtMock, so those Bucket A candidates skip straight to TR1.
- **NxtMock is Bucket A only.** A Bucket B/C candidate with NxtMock data is an
  anomaly → Reconciliation.

## 3. Development Assessment (Bucket B)

- Modeled as **Web Dev + React**, shown as two parts but with **one combined
  result**: the "Bucket B Assessment Status" (Cleared / Not Cleared) is
  authoritative.
- Historical nuance: **up to cycle 4**, a candidate had to attempt both Web Dev
  evaluations but needed to clear only one. **Later, React became compulsory** —
  even if they cleared basic HTML/CSS web dev, they must clear React. If they
  gave React directly, they need not redo web dev.
- For routing, trust the combined "Bucket B Assessment Status".

## 4. TR clearance — the 70% rule

Clearance of a TR round is **score-based at 70%**, NOT the hire wording:

| Round | Scale | Cleared threshold |
|-------|-------|-------------------|
| TR1 (Bucket B) | out of 15 | **≥ 10.5** |
| TR1 (Bucket C / other) | out of 10 | **≥ 7** |
| TR2 | out of 10 | **≥ 7** |

- "**Shortlisted**" does **not** mean cleared — it means capable enough to sit for
  placement even if that round wasn't cleared.
- "**Moved**" (in the TR1 interview sheet) means cleared and advanced to TR2.
- **If the 70% score disagrees with the interview-sheet wording (Moved / Final
  Status / Shortlisted), the case goes to Reconciliation** — the team treats 70%
  as the rule and verifies exceptions by hand.

## 5. Placement Pool

Reaching the pool = all assessments + interviews done. Two sub-groups, kept
separate:

- **Complete** — cleared **both** TRs (the proper path). For Bucket C, clearing
  their single TR counts as complete.
- **Partial** — cleared **one** TR (e.g. TR1 only) and in the pool.
- **Rare exception:** a candidate in the placement pool who did **not** clear TR2
  (shortlisted/moved without a 70% clear). Record on the profile as "not cleared
  TR2, still in placement pool" → Reconciliation.

## 6. "Appeared" vs "Not appeared"

Every stage can have candidates who **did not appear**. This is a first-class,
filterable state per stage (distinct from appeared-but-failed). For the current
stage:
- NxtMock: appeared = status present and not "Not Attempted".
- Dev Assessment: appeared = a Bucket-B status or a web/react attempt exists.
- TR1 / TR (C): appeared = a TR1 score, decision, or interview-tab entry exists.
- TR2: appeared = a TR2 score / decision exists.
- Offline Not Qualified & Placement Pool: appeared = true.

## 7. Reconciliation cases (manual review)

The 70% rule wins; anything that disagrees or is structurally odd is flagged for
a human, not auto-resolved:

- Bucket B candidate that has **NxtMock** data.
- **Cleared TR2 without clearing TR1.**
- TR1 has **both** a /15 and a /10 score.
- 70% score **disagrees** with the interview tab's Moved / Final Status / Shortlisted.
- (Existing import-time kinds remain: unmatched UID, bucket switch, count notes.)

---

## 8. Data sources (the live tracking sheets)

All three are tabs/sheets shared "anyone with the link"; fetched as CSV via
`https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<GID>`.

### 8a. Main tracking sheet — per-student stage data (~2719 rows)
- ID `1FnP2G6pWT2hzkAWaHfDAc1h5G3s6TWM2R2caalArjfo`, **gid `0`**.
- **Row 0** = merged group labels; **row 1** = real headers; data from row 2.
- Column map (index → meaning):
  - 0 User ID · 1 Student Name · 2 SC Mail (coordinator, NOT student email) ·
    3 Cycle · 4 Bucket · 5–11 Upgraded Bucket (Apr 5 → Jun 14) · 12 YOG
  - 13 Bucket A NxtMock status · 14 Web Developer status · 15 React status ·
    16 **Bucket B Assessment Status** (Cleared/Not Cleared) · 17 Bucket C eligible
  - 18 TR1 (hire wording) · 19 TR2 (hire wording)
  - 20 TR1 total /15 (clear ≥10.5) · 21 TR2 total /10 (clear ≥7) · 22 TR1 total /10 (clear ≥7)
  - 23 Students Best bucket (e.g. "Offline Qualified Bucket - B", "Offline Not Qualified")
- `#REF!` / `#N/A` cells are treated as blank.

### 8b. Contact sheet — UID → phone/email (all ~2719 covered)
- ID `13UhvwUiitFzyxqPjx8XgrB1Va6np7wp56bBwRu883Ps`.
- Preferred tab gid `551739889` (User ID, Student Name, Mobile Number, Email ID);
  fill any gaps from gids `644580170`, `291801740`, `366657395`.
- Verified: every UID resolves to a **unique** 10-digit phone and a unique email.

### 8c. Interview tabs (same workbook as the main sheet) — for cross-check
- **TR1** gid `435628243`: col 0 Candidate ID, col 31 "Final Status"
  (Strong/Medium/Low Hire, Rejected), col 34 "Moved to TR2".
- **TR2** gid `1633103522`: col 0 Candidate ID, col 26 "Final Status"
  (Shortlisted / Rejected).
- **Bucket B frontend TR** gid `879780805`: col 0 Candidate ID, col 61 "Final
  Status" (Cleared / Not Cleared). NOTE: this is the *interview*, distinct from
  the automated "Bucket B Assessment Status" in 8a — do not equate them.

## 9. Computed funnel snapshot (for sanity-checking imports)

From a clean load of all 2719 (70% rule + cross-checks):
- Effective bucket: D 1414 · B 933 · C 222 · A 150
- Current stage: Offline-NotQualified 1456 · Dev Assessment 770 · TR1 255 ·
  TR (C) 182 · TR2 23 · Placement Pool 23 · NxtMock 10
- Placement pool: complete 23 · partial 43
- Reconciliation (real conflicts only): ~23
