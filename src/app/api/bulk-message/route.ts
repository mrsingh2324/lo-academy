import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getActor } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { studentWhereFromParams, describeFilter, type RosterParams } from "@/lib/roster";
import type { Prisma } from "@prisma/client";

const CHANNELS = ["email", "whatsapp", "sms"] as const;
type Channel = (typeof CHANNELS)[number];

// POST: queue a bulk message to every student matching the filter.
// This is the "connector" — it writes to the `messages` log via the mocked
// provider; swap src/lib/adapters.ts to wire a real email/WhatsApp/SMS provider.
export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor || !["ops", "admin"].includes(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { filter, channel, subject, body } = (await req.json()) as {
    filter: RosterParams; channel: Channel; subject?: string; body: string;
  };
  if (!CHANNELS.includes(channel)) return NextResponse.json({ error: "bad channel" }, { status: 400 });
  if (!body?.trim()) return NextResponse.json({ error: "message body required" }, { status: 400 });

  const where = studentWhereFromParams(filter ?? {});
  const students = await prisma.student.findMany({ where, select: { id: true, email: true, phone: true } });

  // need email for email channel; phone for whatsapp/sms
  const needsPhone = channel !== "email";
  const targets = students.filter((s) => (needsPhone ? !!s.phone : !!s.email && !s.email.endsWith("@placeholder.invalid")));
  const skipped = students.length - targets.length;

  const now = new Date();
  const rows: Prisma.MessageCreateManyInput[] = targets.map((s) => ({
    id: randomUUID(),
    studentId: s.id,
    channel,
    templateKey: `bulk_${channel}`,
    payload: { subject: subject ?? null, body, to: needsPhone ? s.phone : s.email } as Prisma.InputJsonValue,
    status: "sent", // mock provider; real adapter would set queued→delivered
    providerMessageId: `mock-bulk-${channel}-${s.id.slice(0, 8)}`,
    sentAt: now,
  }));

  // chunked insert
  for (let i = 0; i < rows.length; i += 500) await prisma.message.createMany({ data: rows.slice(i, i + 500) });

  await audit(prisma, {
    entity: "bulk_message",
    entityId: channel,
    actorId: actor.id,
    action: "bulk_send",
    after: { channel, matched: students.length, sent: targets.length, skipped, filter: describeFilter(filter ?? {}) },
  });

  return NextResponse.json({ ok: true, matched: students.length, sent: targets.length, skipped, channel });
}

// GET: export the matching recipients (id, name, email, phone) as CSV.
export async function GET(req: NextRequest) {
  const actor = await getActor();
  if (!actor || !["ops", "admin"].includes(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const p = req.nextUrl.searchParams;
  const where = studentWhereFromParams({ stage: p.get("stage") ?? undefined, bucket: p.get("bucket") ?? undefined, yog: p.get("yog") ?? undefined, q: p.get("q") ?? undefined });
  const students = await prisma.student.findMany({ where, select: { externalRef: true, name: true, email: true, phone: true }, orderBy: { name: "asc" } });
  const esc = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const csv = ["UID,Name,Email,Phone", ...students.map((s) => [s.externalRef, s.name, s.email, s.phone].map(esc).join(","))].join("\n");
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="recipients.csv"' },
  });
}
