import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { STAGE_LABELS } from "@/lib/enums";
import { fmtDate } from "@/lib/ui";
import ActionButton from "@/components/ActionButton";

export const dynamic = "force-dynamic";

export default async function Releases() {
  const [ready, awaiting, needsReview, recentlyNotified] = await Promise.all([
    prisma.stageAttempt.findMany({ where: { status: "evaluated" }, include: { student: { include: { bucket: true } } }, orderBy: { updatedAt: "desc" }, take: 200 }),
    prisma.stageAttempt.findMany({ where: { status: "released", notifiedAt: null }, include: { student: true }, orderBy: { releasedAt: "desc" }, take: 200 }),
    prisma.stageAttempt.findMany({ where: { status: "needs_review" }, include: { student: true }, orderBy: { updatedAt: "desc" }, take: 200 }),
    prisma.stageAttempt.count({ where: { notifiedAt: { not: null } } }),
  ]);

  // group ready-to-release by stage + bucket for batch release
  const groups = new Map<string, { stage: string; bucket: string; ids: string[] }>();
  for (const a of ready) {
    const bucket = a.student.bucket?.name ?? "—";
    const key = `${a.stage}|${bucket}`;
    if (!groups.has(key)) groups.set(key, { stage: a.stage, bucket, ids: [] });
    groups.get(key)!.ids.push(a.id);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">Result Releases</h1>
          <p className="text-sm text-zinc-500">
            Scores are entered by evaluators; <b>you</b> release them, then the pipeline notifies students automatically. {recentlyNotified.toLocaleString()} already notified.
          </p>
        </div>
        <ActionButton label="Process queue now" endpoint="/api/jobs/run" body={{}} variant="ghost" />
      </div>

      {/* Ready to release (ops notified scores are in) */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">Ready to release ({ready.length})</h2>
        {groups.size === 0 ? (
          <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-400">Nothing awaiting release.</p>
        ) : (
          <div className="space-y-2">
            {[...groups.values()].map((g) => (
              <div key={`${g.stage}-${g.bucket}`} className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-3">
                <div className="text-sm">
                  <span className="font-medium text-zinc-900">{STAGE_LABELS[g.stage] ?? g.stage}</span>
                  <span className="text-zinc-500"> · Bucket {g.bucket} · {g.ids.length} student(s)</span>
                </div>
                <ActionButton
                  label={`Release all ${g.ids.length}`}
                  endpoint="/api/results/release"
                  body={{ action: "release", attemptIds: g.ids }}
                  confirm={`Release results for ${g.ids.length} ${g.stage.toUpperCase()} / Bucket ${g.bucket} students? Students will be notified automatically.`}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Released, queued for send (cancellable) */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">Released — queued for send ({awaiting.length})</h2>
        {awaiting.length === 0 ? (
          <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-400">None queued.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-zinc-100">
                {awaiting.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2">
                      <Link href={`/org/students/${a.studentId}`} className="text-zinc-800 hover:text-violet-700">{a.student.name}</Link>
                      <span className="ml-2 text-xs text-zinc-400">{a.stage} · released {fmtDate(a.releasedAt)}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <ActionButton label="Cancel" endpoint="/api/results/release" body={{ action: "cancel", attemptIds: [a.id] }} variant="danger" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Needs review (validation failed / send exhausted) */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">Needs review ({needsReview.length})</h2>
        {needsReview.length === 0 ? (
          <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-400">All clear.</p>
        ) : (
          <div className="space-y-2">
            {needsReview.map((a) => (
              <div key={a.id} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-sm">
                <Link href={`/org/students/${a.studentId}`} className="font-medium text-zinc-900 hover:text-violet-700">{a.student.name}</Link>
                <span className="ml-2 text-xs text-zinc-500">{a.stage}</span>
                <div className="text-amber-800">⚠ {a.needsReviewReason}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
