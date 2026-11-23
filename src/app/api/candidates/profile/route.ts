import { z } from "zod";
import { session } from "@/lib/auth";
import { getProject } from "@/lib/data";
import { serviceDb } from "@/lib/db";
import { jsonError, sameOrigin } from "@/lib/http";

const profileSchema = z.strictObject({
  projectId: z.uuid(),
  applicationId: z.uuid(),
  profile: z.strictObject({
    name: z.string().trim().max(100).nullable(),
    email: z.union([z.email().max(320), z.literal("")]).transform((value) => value || null).nullable(),
    year: z.string().trim().max(80).nullable(),
    interests: z.array(z.string().trim().min(1).max(100)).max(20),
    skills: z.array(z.string().trim().min(1).max(100)).max(30),
    relevant_experience: z.array(z.string().trim().min(1).max(500)).max(12),
  }),
});

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin.", 403);
  const current = await session();
  if (!current || current.profile.role !== "reviewer") return jsonError("Reviewer access is required.", 403);
  const parsed = profileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the candidate profile fields.", 400);

  try {
    await getProject(current.db, parsed.data.projectId, current.profile.id);
  } catch {
    return jsonError("Project not found.", 404);
  }

  const profile = {
    ...parsed.data.profile,
    name: parsed.data.profile.name || null,
    email: parsed.data.profile.email?.toLowerCase() || null,
  };
  const { error } = await serviceDb().from("applications").update({
    profile,
    applicant_name: profile.name,
    applicant_email: profile.email,
  }).eq("id", parsed.data.applicationId).eq("project_id", parsed.data.projectId).eq("source", "upload");

  if (error?.code === "23505") return jsonError("Another candidate in this project already uses that email.", 409);
  if (error) return jsonError("The profile could not be saved. Try again.", 503);
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
