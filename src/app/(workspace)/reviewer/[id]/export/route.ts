import { session } from "@/lib/auth";
import { getProject } from "@/lib/data";
import { shortlistCsv, type CsvRow } from "@/lib/csv";
import { jsonError } from "@/lib/http";
import { idSchema } from "@/lib/schema";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const current = await session();
  if (!current || current.profile.role !== "reviewer") return jsonError("Reviewer access required.", 403);
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return jsonError("Project not found.", 404);
  try {
    await getProject(current.db, id, current.profile.id);
  } catch {
    return jsonError("Project not found.", 404);
  }

  const rows: CsvRow[] = [];
  const batch = 250;
  for (let offset = 0; ; offset += batch) {
    const { data, error } = await current.db.rpc("shortlist_csv_rows_for_reviewer", { p_reviewer: current.profile.id, p_project: id }).range(offset, offset + batch - 1);
    if (error?.message === "project_not_found") return jsonError("Project not found.", 404);
    if (error?.message === "export_before_deadline") return jsonError("Shortlist export opens after the application deadline.", 409);
    if (error || !data) return jsonError("The shortlist could not be exported.", 503);
    rows.push(...(data as CsvRow[]));
    if (data.length < batch) break;
    if (offset >= 4750) return jsonError("This shortlist exceeds the export capacity. Contact the portal administrator.", 413);
  }
  const csv = shortlistCsv(rows);
  if (Buffer.byteLength(csv) > 4_000_000) return jsonError("This shortlist exceeds the export capacity. Contact the portal administrator.", 413);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="e-club-shortlist-${id}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
