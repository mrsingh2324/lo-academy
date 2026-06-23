import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { studentWhereFromParams, describeFilter, rosterQuery } from "@/lib/roster";
import BulkActionForm from "@/components/BulkActionForm";

export const dynamic = "force-dynamic";

export default async function BulkAction({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; bucket?: string; yog?: string; q?: string; outcome?: string }>;
}) {
  const sp = await searchParams;
  const where = studentWhereFromParams(sp);

  const [total, withEmail, withPhone] = await Promise.all([
    prisma.student.count({ where }),
    prisma.student.count({ where: { AND: [where, { NOT: { email: { endsWith: "@placeholder.invalid" } } }] } }),
    prisma.student.count({ where: { AND: [where, { NOT: { phone: null } }] } }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/org/roster${rosterQuery(sp) ? `?${rosterQuery(sp)}` : ""}`} className="text-sm text-zinc-500 hover:underline">
          ← Back to roster
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-zinc-900">
          Take action on {total.toLocaleString()} students
        </h1>
        <p className="text-sm text-zinc-500">Filter: {describeFilter(sp)}</p>
      </div>

      <BulkActionForm filter={sp} total={total} withEmail={withEmail} withPhone={withPhone} />
    </div>
  );
}
