import { session } from "@/lib/auth";
import { getProject } from "@/lib/data";
import { serviceDb } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { idSchema } from "@/lib/schema";
import { resumeBucket } from "@/lib/storage";

export async function GET(request: Request, context: { params: Promise<{ id: string; applicationId: string }> }) {
  const current = await session();
  if (!current || current.profile.role !== "reviewer") return jsonError("Reviewer access required.", 403);
  const { id, applicationId } = await context.params;
  if (![id, applicationId].every((value) => idSchema.safeParse(value).success)) return jsonError("Application not found.", 404);
  try {
    await getProject(current.db, id, current.profile.id);
  } catch {
    return jsonError("Application not found.", 404);
  }
  const { data: application, error } = await current.db.from("applications").select("resume_path,submission_version")
    .eq("id", applicationId).eq("project_id", id).maybeSingle();
  if (error) return jsonError("The resume could not be loaded.", 503);
  if (!application) return jsonError("Application not found.", 404);
  const version = new URL(request.url).searchParams.get("v");
  if (version !== String(application.submission_version)) return jsonError("The application changed. Refresh the review page.", 409);
  const { data, error: signingError } = await serviceDb().storage.from(resumeBucket).createSignedUrl(application.resume_path, 60);
  if (signingError || !data) return jsonError("The resume is temporarily unavailable.", 503);
  return new Response(null, { status: 307, headers: { Location: data.signedUrl, "Cache-Control": "private, no-store" } });
}
