import { z } from "zod";
import { session } from "@/lib/auth";
import { extractCandidateProfile, quotaConfig } from "@/lib/ai";
import { serviceDb } from "@/lib/db";
import { redactEvidence } from "@/lib/evaluation";
import { jsonError, sameOrigin } from "@/lib/http";
import { parsePdf, PdfError } from "@/lib/pdf";
import { readResume, UploadError } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

const inputSchema = z.strictObject({
  projectId: z.uuid(),
  resumePath: z.string().min(1).max(200),
  extraPaths: z.array(z.string().min(1).max(200)).max(3),
  name: z.string().trim().max(100).optional().default(""),
  email: z.union([z.email().max(320), z.literal("")]).optional().default(""),
  links: z.array(z.url({ protocol: /^https?$/ }).max(2048).refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password;
  })).max(5),
  notes: z.string().max(10000),
});

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin.", 403);
  const current = await session();
  if (!current || current.profile.role !== "reviewer") return jsonError("Reviewer access is required.", 403);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the candidate details, links, and PDF files.", 400);

  const db = serviceDb();
  const input = parsed.data;
  const paths = [input.resumePath, ...input.extraPaths];
  if (new Set(paths).size !== paths.length) return jsonError("A file was selected more than once.", 400);

  const { data: tickets, error: ticketError } = await db.from("upload_tickets")
    .select("path,created_at,finalized_at")
    .in("path", paths)
    .eq("user_id", current.profile.id)
    .eq("project_id", input.projectId);
  if (ticketError || !tickets || tickets.length !== paths.length || tickets.some((ticket) =>
    ticket.finalized_at || Date.parse(ticket.created_at) < Date.now() - 20 * 60_000)) {
    return jsonError("An upload expired. Please select the files again.", 409);
  }

  try {
    const documents = await Promise.all(paths.map(async (path) => {
      const bytes = await readResume(db, path);
      return parsePdf(bytes, 5 * 1024 * 1024, true);
    }));
    const [resume, ...additionalDocuments] = documents;
    const suppliedName = input.name.trim() || undefined;
    const redact = (text: string) => redactEvidence(text, { name: suppliedName, student_id: null }).text;
    const emailFromDocuments = documents.join("\n").match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] || null;
    const safeLinks = input.links.map((link) => {
      const url = new URL(link);
      return url.origin;
    });
    const { data: quota, error: quotaError } = await db.rpc("reserve_ai_call", quotaConfig());
    if (quotaError) return jsonError("AI processing is temporarily unavailable.", 503);
    if (typeof quota === "string") return jsonError("AI processing limit reached. Please retry later.", 429);
    const extracted = await extractCandidateProfile({
      resume: redact(resume),
      additionalDocuments: additionalDocuments.map(redact),
      links: safeLinks,
      notes: redact(input.notes),
    });
    const profile = {
      ...extracted,
      name: input.name || extracted.name,
      email: input.email.toLowerCase() || emailFromDocuments || extracted.email,
    };

    const { data: id, error } = await db.rpc("create_uploaded_candidate", {
      p_reviewer: current.profile.id,
      p_project: input.projectId,
      p_resume_path: input.resumePath,
      p_extra_paths: input.extraPaths,
      p_name: profile.name,
      p_email: profile.email,
      p_links: input.links,
      p_notes: input.notes,
      p_profile: profile,
    });
    if (error || !id) {
      if (error?.message.includes("duplicate_applicant")) return jsonError("A candidate with this email is already in the project. This file was skipped.", 409);
      if (error?.message.includes("upload_expired")) return jsonError("An upload expired. Please select the files again.", 409);
      if (error?.message.includes("applicant_invalid")) return jsonError("Check the candidate name, email, links, and notes.", 400);
      return jsonError("The candidate could not be saved. Try again.", 409);
    }
    return Response.json({ id, profile }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PdfError) return jsonError("Each document must be a readable PDF with no more than 20 pages.", 415);
    if (error instanceof UploadError) return jsonError("A PDF could not be verified in private storage.", 415);
    return jsonError("Candidate profile extraction is unavailable. No candidate record was created.", 503);
  }
}
