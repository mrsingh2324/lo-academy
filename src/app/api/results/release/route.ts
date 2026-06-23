import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth";
import { releaseAttempts, cancelRelease, findReleasable } from "@/lib/release";

// Release (the only human step) or cancel a release. Ops/Admin only.
export async function POST(req: NextRequest) {
  const actor = await getActor();
  if (!actor || !["ops", "admin"].includes(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { action, attemptIds, filter } = await req.json();

  if (action === "cancel") {
    const cancelled = await cancelRelease(attemptIds ?? [], actor.id);
    return NextResponse.json({ ok: true, cancelled });
  }

  // release: explicit ids, or resolve a batch filter (stage/bucket/date)
  let ids: string[] = Array.isArray(attemptIds) ? attemptIds : [];
  if (ids.length === 0 && filter) ids = (await findReleasable(filter)).map((a) => a.id);
  const released = await releaseAttempts(ids, actor.id);
  return NextResponse.json({ ok: true, released });
}
