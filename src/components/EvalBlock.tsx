// Renders a multi-part evaluation (Bucket B frontend / DSA): each "part" shows
// its sub-criteria + average; scalar fields render as labelled rows; URLs link.
const LABELS: Record<string, string> = {
  part1_takeHome: "Part 1 · Take-Home Assignment",
  part2_frontendConceptual: "Part 2 · Frontend Conceptual",
  part3_reactLiveCoding: "Part 3 · React Live Coding",
  part1_resume: "Part 1 · Resume Drill-Down",
  part2_dsa: "Part 2 · DSA Problem Solving",
  overallScore: "Overall Score",
  total10: "Total (/10)",
  band: "Band",
  performanceBand: "Performance Band",
  clearanceStatus: "Clearance",
  finalStatus: "Final Status",
  weightedAverage: "Weighted Average",
  overallSummary: "Overall Summary",
  overallRemarks: "Remarks",
  remarks: "Remarks",
  interviewDate: "Interview Date",
  codingSubmission: "Coding Submission",
  recording: "Recording",
  depthAuthenticity: "Depth & Authenticity",
  technicalDecisions: "Technical Decisions",
  failuresReasoning: "Failures / Limitations",
  approachReasoning: "Approach & Reasoning",
  edgeCases: "Edge Cases & Correctness",
  complexity: "Complexity Awareness",
  avg: "Avg",
};
const lbl = (k: string) => LABELS[k] ?? k.replace(/_/g, " ");
const isUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//.test(v);
const Val = ({ v }: { v: unknown }) =>
  isUrl(v) ? <a href={v} target="_blank" className="text-violet-600 hover:underline">open ↗</a> : <span>{String(v)}</span>;

function isPart(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export default function EvalBlock({ title, data }: { title: string; data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v != null && v !== "");
  const parts = entries.filter(([k]) => k.startsWith("part"));
  const scalars = entries.filter(([k]) => !k.startsWith("part"));

  return (
    <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="mb-2 text-sm font-semibold text-zinc-800">{title}</div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {parts.map(([k, part]) => {
          const p = isPart(part) ? part : {};
          const items = Array.isArray(p.items) ? (p.items as unknown[]) : Object.entries(p).filter(([kk]) => kk !== "avg").map(([kk, vv]) => `${lbl(kk)}: ${vv}`);
          return (
            <div key={k} className="rounded-md bg-zinc-50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{lbl(k)}</span>
                {p.avg != null && <span className="text-xs font-medium text-zinc-700">avg {String(p.avg)}</span>}
              </div>
              <ul className="mt-1 space-y-0.5 text-sm text-zinc-700">
                {items.map((it, i) => <li key={i}>• {String(it)}</li>)}
              </ul>
            </div>
          );
        })}
      </div>

      {scalars.length > 0 && (
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm md:grid-cols-2">
          {scalars.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="shrink-0 text-zinc-500">{lbl(k)}:</dt>
              <dd className="min-w-0 break-words text-zinc-800"><Val v={v} /></dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
