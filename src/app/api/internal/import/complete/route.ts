import { z } from "zod";
import { session } from "@/lib/auth";
import { resumeLimitBytes } from "@/lib/config";
import { serviceDb } from "@/lib/db";
import { jsonError, sameOrigin } from "@/lib/http";
import { parsePdf, PdfError } from "@/lib/pdf";
import { readResume } from "@/lib/storage";

export const runtime = "nodejs";

const inputSchema = z.object({
  projectId: z.uuid(),
  path: z.string().max(200),
  name: z.string().trim().min(1).max(100),
  email: z.email().max(320),
  studentId: z.string().trim().max(40).optional(),
  interests: z.array(z.string().trim().min(1).max(80)).max(20),
});

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin.", 403);
  const current = await session();
  if (!current || current.profile.role !== "reviewer") return jsonError("Reviewer access is required.", 403);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the applicant details.", 400);

  const db = serviceDb();
  const { path, projectId, name, email, studentId, interests } = parsed.data;
  const { data: ticket, error: ticketError } = await db.from("upload_tickets").select("created_at,finalized_at")
    .eq("path", path).eq("user_id", current.profile.id).eq("project_id", projectId).maybeSingle();
  if (ticketError) return jsonError("We couldn’t verify the upload. Try again.", 503);
  if (!ticket || ticket.finalized_at || Date.parse(ticket.created_at) < Date.now() - 20 * 60_000) {
    return jsonError("This upload expired. Start the import again.", 409);
  }

  try {
    const bytes = await readResume(db, path);
    await parsePdf(bytes, resumeLimitBytes(), false);
  } catch (error) {
    if (error instanceof PdfError && error.code === "unsupported_pdf") return jsonError("Use a PDF with 20 pages or fewer.", 415);
    if (error instanceof PdfError) return jsonError("Upload a readable, unencrypted PDF.", 415);
    return jsonError("The PDF could not be verified in private storage.", 503);
  }

  const { data: id, error } = await db.rpc("import_applicant", {
    p_reviewer: current.profile.id,
    p_project: projectId,
    p_path: path,
    p_name: name,
    p_email: email,
    p_student_id: studentId || null,
    p_interests: interests,
  });
  if (error || !id) {
    if (error?.message.includes("duplicate_applicant")) return jsonError("An applicant with this email is already imported for this project.", 409);
    if (error?.message.includes("applicant_invalid")) return jsonError("The applicant details are invalid.", 400);
    return jsonError("The import could not be saved. Check the project and try again.", 409);
  }
  return Response.json({ id }, { headers: { "Cache-Control": "no-store" } });
}
