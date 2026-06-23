"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Generic POST-and-refresh button for ops actions (release, cancel, run queue).
export default function ActionButton({
  label,
  endpoint,
  body,
  variant = "primary",
  confirm,
}: {
  label: string;
  endpoint: string;
  body: unknown;
  variant?: "primary" | "ghost" | "danger";
  confirm?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const cls =
    variant === "primary"
      ? "bg-violet-600 text-white hover:bg-violet-700"
      : variant === "danger"
        ? "bg-rose-600 text-white hover:bg-rose-700"
        : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50";

  async function go() {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setMsg(null);
    const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) {
      const n = data.released ?? data.cancelled ?? data.ran;
      setMsg(n != null ? `✓ ${n}` : "✓");
      router.refresh();
    } else setMsg(`✗ ${data.error ?? "failed"}`);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={go} disabled={busy} className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${cls}`}>
        {busy ? "…" : label}
      </button>
      {msg && <span className="text-xs text-zinc-500">{msg}</span>}
    </span>
  );
}
