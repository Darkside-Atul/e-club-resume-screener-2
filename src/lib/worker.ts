import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { quotaConfig, screenEvidence, ScreeningError, screeningProvider, verifySynthetic } from "./ai";
import { resumeLimitBytes, retentionDays } from "./config";
import { getRubric } from "./data";
import { parsePdf, PdfError } from "./pdf";
import { readResume, resumeBucket, UploadError } from "./storage";
import type { Job, Screening } from "./types";

class QuotaDelay extends Error {
  constructor(readonly until: string) { super("quota_delay"); }
}

export async function processScreening(db: SupabaseClient, job: Job) {
  let result: Screening | null = null;
  let failure: ScreeningError | null = null;
  try {
    const { data: application, error } = await db.from("applications")
      .select("id,project_id,user_id,applicant_name,applicant_student_id,resume_path,answers,rubric_version,submission_version")
      .eq("id", job.application_id).maybeSingle();
    if (error) throw new ScreeningError("database_unavailable", true);
    if (!application || application.submission_version !== job.submission_version) return;
    const provider = screeningProvider();
    if (provider.mode === "synthetic") verifySynthetic(application.project_id, undefined, !!application.answers.length);
    const [{ data: project, error: projectError }, rubric, bytes, legacyApplicantResult] = await Promise.all([
      db.from("projects").select("questions").eq("id", application.project_id).single(),
      getRubric(db, application.project_id, application.rubric_version),
      readResume(db, application.resume_path),
      application.user_id
        ? db.from("profiles").select("name,student_id").eq("id", application.user_id).single()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const applicant = application.applicant_name
      ? { name: application.applicant_name, student_id: application.applicant_student_id }
      : legacyApplicantResult.data;
    if (projectError || !project || legacyApplicantResult.error || !applicant) throw new ScreeningError("database_unavailable", true);
    if (provider.mode === "synthetic") verifySynthetic(application.project_id, bytes, !!project.questions.length);
    const text = await parsePdf(bytes, resumeLimitBytes(), true);
    const evaluation = await screenEvidence(provider.generate, text, project.questions, application.answers, rubric,
      applicant, async () => {
        const { data, error: quotaError } = await db.rpc("reserve_ai_call", quotaConfig());
        if (quotaError) throw new ScreeningError("database_unavailable", true);
        if (typeof data === "string") throw new QuotaDelay(data);
      });
    result = { ...evaluation, rubric_version: rubric.version };
  } catch (error) {
    if (error instanceof QuotaDelay || (error instanceof ScreeningError && error.code === "quota_wait")) {
      const { error: deferError } = await db.rpc("defer_screening", {
        p_job: job.id, p_lease: job.lease_token,
        p_until: error instanceof QuotaDelay ? error.until : new Date(Date.now() + 120000).toISOString(),
        p_cooldown: !(error instanceof QuotaDelay),
      });
      if (deferError) throw new Error("queue_defer_failed");
      return;
    }
    if (error instanceof ScreeningError) failure = error;
    else if (error instanceof PdfError) failure = new ScreeningError(error.code, error.code === "pdf_timeout");
    else if (error instanceof UploadError) failure = new ScreeningError(
      error.reason === "storage" ? "storage_unavailable" : "resume_unavailable", error.reason === "storage");
    else failure = new ScreeningError("screening_unavailable", true);
  }

  const { error } = await db.rpc("finish_screening", {
    p_job: job.id, p_lease: job.lease_token, p_result: result,
    p_error: failure?.code ?? null, p_retry: failure?.retry ?? false,
  });
  if (error) throw new Error("queue_completion_failed");
}

export async function processCleanup(db: SupabaseClient) {
  const { error } = await db.rpc("prepare_resume_cleanup", { p_retention_days: retentionDays() });
  if (error) throw new Error("cleanup_prepare_failed");
  const { data, error: lookupError } = await db.from("resume_deletions").select("path")
    .lte("run_after", new Date().toISOString()).order("run_after").limit(30);
  if (lookupError) throw new Error("cleanup_lookup_failed");
  const paths = (data || []).map(({ path }) => path as string);
  if (!paths.length) return;
  const { error: storageError } = await db.storage.from(resumeBucket).remove(paths);
  if (storageError) throw new Error("cleanup_storage_failed");
  const { error: deletionError } = await db.from("resume_deletions").delete().in("path", paths);
  if (deletionError) throw new Error("cleanup_records_failed");
}
