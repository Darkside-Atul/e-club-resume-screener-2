import { z } from "zod";
import { session } from "@/lib/auth";
import { resumeLimitBytes } from "@/lib/config";
import { serviceDb } from "@/lib/db";
import { jsonError, sameOrigin } from "@/lib/http";
import { resumeBucket } from "@/lib/storage";

const inputSchema = z.object({
  projectId: z.uuid(),
  size: z.number().int().positive(),
  mediaType: z.literal("application/pdf"),
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
  if (!parsed.success) return jsonError("Check the applicant details and PDF file.", 400);
  if (parsed.data.size > resumeLimitBytes()) return jsonError("This PDF exceeds the configured file size limit.", 413);

  const db = serviceDb();
  const { data: path, error } = await db.rpc("begin_internal_resume_upload", {
    p_reviewer: current.profile.id,
    p_project: parsed.data.projectId,
  });
  if (error || typeof path !== "string") return jsonError("A private upload could not be prepared.", 409);
  const { data, error: signingError } = await db.storage.from(resumeBucket).createSignedUploadUrl(path, { upsert: false });
  if (signingError || !data) return jsonError("Private upload storage is temporarily unavailable.", 503);
  return Response.json({ path, token: data.token }, { headers: { "Cache-Control": "no-store" } });
}
