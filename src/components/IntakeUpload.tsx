"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Result = { received: number; created: number; skipped: number; byBucket: Record<string, number> };

export default function IntakeUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true); setErr(null); setResult(null); setFileName(file.name);
    try {
      const csv = await file.text();
      const r = await fetch("/api/intake/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv }) });
      const data = await r.json();
      if (r.ok) { setResult(data); router.refresh(); }
      else setErr(data.error ?? "Upload failed");
    } catch {
      setErr("Could not read the file");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-violet-300 bg-violet-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-zinc-900">Onboard newly qualified students</div>
          <div className="text-xs text-zinc-500">
            Upload the offline-qualification sheet (CSV with <b>User ID</b>, <b>Name</b>, <b>YOG</b>, <b>bucket</b>). New students are added to their bucket at the first stage; re-uploading never duplicates.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Upload sheet (CSV)"}
          </button>
        </div>
      </div>

      {fileName && !err && (
        <div className="mt-3 text-sm">
          {result ? (
            <span className="text-emerald-700">
              ✓ <b>{fileName}</b>: added {result.created.toLocaleString()} new ({Object.entries(result.byBucket).filter(([, n]) => n > 0).map(([b, n]) => `${b}:${n}`).join("  ")}); {result.skipped.toLocaleString()} already existed.
            </span>
          ) : busy ? (
            <span className="text-zinc-500">Processing {fileName}…</span>
          ) : null}
        </div>
      )}
      {err && <div className="mt-3 text-sm text-rose-600">✗ {err}</div>}
      <div className="mt-1 text-[11px] text-zinc-400">XLSX? Export it as CSV first. Very large sheets (1000s) may take a moment.</div>
    </div>
  );
}
