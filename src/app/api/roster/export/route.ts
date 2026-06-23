import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor } from "@/lib/auth";
import { studentWhereFromParams } from "@/lib/roster";

// Export the currently-filtered roster as CSV (opens in Google Sheets / Excel).
export async function GET(req: NextRequest) {
  const actor = await getActor();
  if (!actor || !["ops", "admin"].includes(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const p = req.nextUrl.searchParams;
  const where = studentWhereFromParams({
    stage: p.get("stage") ?? undefined,
    bucket: p.get("bucket") ?? undefined,
    yog: p.get("yog") ?? undefined,
    q: p.get("q") ?? undefined,
    outcome: p.get("outcome") ?? undefined,
  });

  const students = await prisma.student.findMany({
    where,
    include: { bucket: true, attempts: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { name: "asc" },
  });

  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["UID", "Name", "Email", "Phone", "YOG", "Bucket", "Current Stage", "Status", "Latest Score", "Latest Outcome"];
  const lines = [header.join(",")];
  for (const s of students) {
    const a = s.attempts[0];
    lines.push([
      s.externalRef, s.name, s.email, s.phone, s.yearOfGraduation, s.bucket?.name,
      s.currentStage, s.currentStatus, a?.score ?? "", a?.outcome ?? "",
    ].map(esc).join(","));
  }
  const csv = "﻿" + lines.join("\n"); // BOM so Excel/Sheets read UTF-8 cleanly

  const stamp = new Date().toISOString().slice(0, 10);
  const tag = [p.get("bucket"), p.get("stage"), p.get("yog")].filter(Boolean).join("-") || "all";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="roster-${tag}-${stamp}.csv"`,
    },
  });
}
