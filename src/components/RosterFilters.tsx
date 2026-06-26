"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { stageOptionsForBucket, STAGE_LABELS } from "@/lib/enums";
import { OUTCOMES, OUTCOME_LABELS, STAGE_STATUSES, STAGE_STATUS_LABELS, PROGRESS_FILTERS, PROGRESS_LABELS } from "@/lib/roster";

export default function RosterFilters({
  buckets,
  yogs,
  sizes,
  q,
  stage,
  stageStatus,
  bucket,
  yog,
  outcome,
  progress,
  size,
}: {
  buckets: { name: string }[];
  yogs: number[];
  sizes: number[];
  q?: string;
  stage?: string;
  stageStatus?: string;
  bucket?: string;
  yog?: string;
  outcome?: string;
  progress?: string;
  size?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(q ?? "");
  const [bucketSel, setBucketSel] = useState(bucket ?? "");
  const [stageSel, setStageSel] = useState(stage ?? "");
  const [stageStatusSel, setStageStatusSel] = useState(stageStatus ?? "");
  const [yogSel, setYogSel] = useState(yog ?? "");
  const [outcomeSel, setOutcomeSel] = useState(outcome ?? "");
  const [progressSel, setProgressSel] = useState(progress ?? "");
  const [sizeSel, setSizeSel] = useState(size ?? "20");

  // Stage options cascade from the selected bucket (A→Nxtmock/TR1/TR2, B→Dev test/TR1/TR2, C→TR1, D→Not qualified).
  const stageOpts = stageOptionsForBucket(bucketSel || null);
  // The four-state status only applies to assessment/interview stages.
  const statusApplies = ["nxtmock", "dev_test", "tr1", "tr2"].includes(stageSel);

  function go(override: { size?: string } = {}) {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (stageSel) params.set("stage", stageSel);
    if (stageSel && statusApplies && stageStatusSel) params.set("stageStatus", stageStatusSel);
    if (bucketSel) params.set("bucket", bucketSel);
    if (yogSel) params.set("yog", yogSel);
    if (outcomeSel) params.set("outcome", outcomeSel);
    if (progressSel) params.set("progress", progressSel);
    const sz = override.size ?? sizeSel;
    if (sz && sz !== "20") params.set("size", sz);
    router.push(`/org/roster${params.toString() ? `?${params}` : ""}`);
  }
  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    go();
  }

  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name / email / id"
        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
      />
      <select
        value={bucketSel}
        onChange={(e) => {
          const nb = e.target.value;
          setBucketSel(nb);
          // reset stage if it's not valid for the new bucket
          if (stageSel && !stageOptionsForBucket(nb || null).includes(stageSel as never)) setStageSel("");
        }}
        className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
      >
        <option value="">All buckets</option>
        {buckets.map((b) => (
          <option key={b.name} value={b.name}>
            Bucket {b.name}
          </option>
        ))}
      </select>
      <select
        value={stageSel}
        onChange={(e) => { setStageSel(e.target.value); setStageStatusSel(""); }}
        className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
      >
        <option value="">{bucketSel ? `All ${bucketSel} stages` : "All stages"}</option>
        {stageOpts.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s] ?? s}
          </option>
        ))}
      </select>
      {statusApplies && (
        <select
          value={stageStatusSel}
          onChange={(e) => setStageStatusSel(e.target.value)}
          className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
          title="Status within the selected stage"
        >
          <option value="">Any status at {STAGE_LABELS[stageSel] ?? stageSel}</option>
          {STAGE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STAGE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      )}
      <select
        value={yogSel}
        onChange={(e) => setYogSel(e.target.value)}
        className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
      >
        <option value="">All YOG</option>
        {yogs.map((y) => (
          <option key={y} value={y}>
            YOG {y}
          </option>
        ))}
      </select>
      <select
        value={outcomeSel}
        onChange={(e) => setOutcomeSel(e.target.value)}
        className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
      >
        <option value="">Any outcome</option>
        {OUTCOMES.map((o) => (
          <option key={o} value={o}>
            {OUTCOME_LABELS[o]}
          </option>
        ))}
      </select>
      <select
        value={progressSel}
        onChange={(e) => setProgressSel(e.target.value)}
        className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
        title="Students who haven't moved past their bucket's first stage (NxtMock / Dev test / TR1)"
      >
        <option value="">Any progress</option>
        {PROGRESS_FILTERS.map((p) => (
          <option key={p} value={p}>
            {PROGRESS_LABELS[p]}
          </option>
        ))}
      </select>
      <button className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700">Filter</button>
      <span className="ml-1 flex items-center gap-1 text-sm text-zinc-500">
        Show
        <select
          value={sizeSel}
          onChange={(e) => {
            setSizeSel(e.target.value);
            go({ size: e.target.value });
          }}
          className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
        >
          {sizes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </span>
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setBucketSel("");
          setStageSel("");
          setStageStatusSel("");
          setYogSel("");
          setOutcomeSel("");
          setProgressSel("");
          setSizeSel("20");
          router.push("/org/roster");
        }}
        className="text-sm text-zinc-500 hover:underline"
      >
        Reset
      </button>
    </form>
  );
}
