"use client";
import { useState } from "react";

type Filter = { stage?: string; bucket?: string; yog?: string; q?: string };

const CHANNELS = [
  { key: "email", label: "Email", needs: "email" },
  { key: "whatsapp", label: "WhatsApp", needs: "phone" },
  { key: "sms", label: "SMS", needs: "phone" },
] as const;

export default function BulkActionForm({
  filter,
  total,
  withEmail,
  withPhone,
}: {
  filter: Filter;
  total: number;
  withEmail: number;
  withPhone: number;
}) {
  const [channel, setChannel] = useState<"email" | "whatsapp" | "sms">("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ sent: number; skipped: number; matched: number } | null>(null);

  const reachable = channel === "email" ? withEmail : withPhone;
  const qs = new URLSearchParams(filter as Record<string, string>).toString();

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    setResult(null);
    const r = await fetch("/api/bulk-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filter, channel, subject, body }),
    });
    const data = await r.json();
    setBusy(false);
    if (r.ok) setResult(data);
    else setResult({ sent: 0, skipped: 0, matched: 0 });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="text-sm text-zinc-600">
          Recipients: <span className="font-semibold text-zinc-900">{total.toLocaleString()}</span> students ·
          <span className="ml-1">{withEmail.toLocaleString()} with email</span> ·
          <span className="ml-1">{withPhone.toLocaleString()} with phone</span>
        </div>
        <a href={`/api/bulk-message?${qs}`} className="mt-2 inline-block text-sm text-violet-600 hover:underline">
          ⬇ Export recipients CSV (UID, name, email, phone)
        </a>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="mb-3 flex gap-2">
          {CHANNELS.map((c) => (
            <button
              key={c.key}
              onClick={() => setChannel(c.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${channel === c.key ? "bg-violet-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {channel === "email" && (
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="mb-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
        )}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Message to send via ${channel} to ${reachable.toLocaleString()} reachable students…`}
          rows={5}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
        />

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={send}
            disabled={busy || !body.trim() || reachable === 0}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {busy ? "Sending…" : `Send ${channel} to ${reachable.toLocaleString()} students`}
          </button>
          <span className="text-xs text-zinc-400">
            Uses the messaging connector (mocked → logged to messages; swap the adapter for a live provider).
          </span>
        </div>

        {result && (
          <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
            Queued <span className="font-semibold">{result.sent.toLocaleString()}</span> {channel} message(s).
            {result.skipped > 0 && <span className="text-emerald-700"> {result.skipped.toLocaleString()} skipped (missing {channel === "email" ? "email" : "phone"}).</span>}
          </div>
        )}
      </div>
    </div>
  );
}
