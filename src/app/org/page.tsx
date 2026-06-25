import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { STAGE_LABELS } from "@/lib/enums";
import RunJobsButton from "@/components/RunJobsButton";
import IntakeUpload from "@/components/IntakeUpload";

export const dynamic = "force-dynamic";

// Looker-style horizontal bar chart (server-rendered).
function BarChart({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: number; color: string; href?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      <div className="space-y-2.5">
        {rows.map((r) => {
          const inner = (
            <div className="grid grid-cols-[140px_1fr_40px] items-center gap-3">
              <span className="truncate text-[13px] text-zinc-600">{r.label}</span>
              <span className="h-[22px] overflow-hidden rounded-md bg-zinc-100">
                <span className={`block h-full rounded-md ${r.color}`} style={{ width: `${(r.value / max) * 100}%` }} />
              </span>
              <span className="text-right text-[13px] font-semibold text-zinc-700">{r.value}</span>
            </div>
          );
          return r.href ? (
            <Link key={r.label} href={r.href} className="block rounded-md transition hover:bg-zinc-50">
              {inner}
            </Link>
          ) : (
            <div key={r.label}>{inner}</div>
          );
        })}
      </div>
    </section>
  );
}

export default async function Dashboard() {
  const pendingJobs = await prisma.scheduledJob.count({ where: { status: "pending", runAt: { lte: new Date() } } });
  const [byStage, byBucket, awaitingEval, panelPending, total, reports, reconcile] = await Promise.all([
    prisma.student.groupBy({ by: ["currentStage"], _count: true, where: { deletedAt: null } }),
    prisma.student.findMany({ where: { deletedAt: null }, select: { bucket: { select: { name: true } } } }),
    prisma.stageAttempt.count({ where: { stage: { in: ["nxtmock", "dev_test"] }, status: { in: ["awaiting_result", "under_evaluation"] } } }),
    prisma.stageAttempt.count({ where: { stage: { in: ["tr1", "tr2"] }, status: { in: ["awaiting_result", "under_evaluation"] } } }),
    prisma.student.count({ where: { deletedAt: null } }),
    prisma.report.count(),
    prisma.reconciliationItem.count({ where: { resolved: false } }),
  ]);

  const stageOrder = ["nxtmock", "dev_test", "tr1", "tr2", "placement_pool", "rejected"];
  const stageCounts = Object.fromEntries(byStage.map((s) => [s.currentStage, s._count])) as Record<string, number>;
  const bucketCounts: Record<string, number> = {};
  for (const s of byBucket) {
    const b = s.bucket?.name ?? "—";
    bucketCounts[b] = (bucketCounts[b] ?? 0) + 1;
  }
  const inPool = stageCounts.placement_pool ?? 0;
  const inTR = (stageCounts.tr1 ?? 0) + (stageCounts.tr2 ?? 0);

  // Accented KPI scorecards (Looker-style left border).
  const cards = [
    { label: "Total candidates", value: total, accent: "border-l-blue-500", href: "/org/roster" },
    { label: "In placement pool", value: inPool, accent: "border-l-amber-500", href: "/org/roster?outcome=cleared" },
    { label: "In TR rounds", value: inTR, accent: "border-l-violet-500", href: "/org/roster?stage=tr1" },
    { label: "Tests to grade", value: awaitingEval, accent: "border-l-indigo-500", href: "/org/roster" },
    { label: "Needs reconcile", value: reconcile, accent: "border-l-rose-500", href: "/org/reconciliation" },
  ];

  const stageColor: Record<string, string> = {
    nxtmock: "bg-indigo-400",
    dev_test: "bg-emerald-400",
    tr1: "bg-violet-400",
    tr2: "bg-fuchsia-400",
    placement_pool: "bg-amber-400",
    rejected: "bg-zinc-300",
  };
  const bucketColor: Record<string, string> = { A: "bg-blue-500", B: "bg-emerald-500", C: "bg-amber-500", D: "bg-zinc-400" };

  const stageRows = stageOrder.map((s) => ({
    label: STAGE_LABELS[s] ?? s,
    value: stageCounts[s] ?? 0,
    color: stageColor[s] ?? "bg-zinc-300",
    href: `/org/roster?stage=${s}`,
  }));
  const bucketRows = ["A", "B", "C", "D"]
    .filter((b) => bucketCounts[b] != null)
    .map((b) => ({ label: `Bucket ${b}`, value: bucketCounts[b], color: bucketColor[b] ?? "bg-zinc-400", href: `/org/roster?bucket=${b}` }));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Placement Dashboard</h1>
          <p className="text-sm text-zinc-500">{total.toLocaleString()} candidates · pipeline overview.</p>
        </div>
        <RunJobsButton pending={pendingJobs} />
      </div>

      <IntakeUpload />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className={`rounded-xl border border-l-4 border-zinc-200 bg-white p-4 transition hover:border-zinc-300 hover:shadow-sm ${c.accent}`}
          >
            <div className="text-[28px] font-semibold leading-tight text-zinc-900">{c.value.toLocaleString()}</div>
            <div className="mt-1 text-xs font-medium uppercase tracking-wide text-zinc-500">{c.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <BarChart title="Candidates by stage" rows={stageRows} />
        <BarChart title="Candidates by bucket" rows={bucketRows} />
      </div>

      <p className="text-xs text-zinc-400">Stages: {stageOrder.map((s) => STAGE_LABELS[s]).join(" → ")}</p>
    </div>
  );
}
