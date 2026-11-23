import { z } from "zod";
import { session } from "@/lib/auth";
import { serviceDb } from "@/lib/db";
import { jsonError, sameOrigin } from "@/lib/http";
import { resumeBucket } from "@/lib/storage";

const inputSchema = z.strictObject({
  projectId: z.uuid(),
  size: z.number().int().positive().max(5 * 1024 * 1024),
  mediaType: z.literal("application/pdf"),
});

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin.", 403);
  const current = await session();
  if (!current || current.profile.role !== "reviewer") return jsonError("Reviewer access is required.", 403);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose a PDF no larger than 5 MB.", 400);

  const db = serviceDb();
  const { data: path, error } = await db.rpc("begin_internal_resume_upload", {
    p_reviewer: current.profile.id,
    p_project: parsed.data.projectId,
  });
  if (error || typeof path !== "string") return jsonError("A private upload could not be prepared.", 409);
  const { data, error: signingError } = await db.storage.from(resumeBucket).createSignedUploadUrl(path, { upsert: false });
  if (signingError || !data) return jsonError("Private storage is temporarily unavailable.", 503);
  return Response.json({ path, token: data.token }, { headers: { "Cache-Control": "no-store" } });
}
