"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { homeFor, requireSession } from "@/lib/auth";
import { allowedEmail, appUrl, authorizedDomain, publicConfig } from "@/lib/config";
import { serviceDb, userDb } from "@/lib/db";
import { relevantCriteria } from "@/lib/evaluation";
import { databaseMessage } from "@/lib/http";
import { decisionSchema, idSchema, profileSchema, projectSchema } from "@/lib/schema";

export type FormState = { error?: string; success?: string };

function passwordFormValues(form: FormData) {
  const email = z.email().safeParse(String(form.get("email") || "").trim().toLowerCase());
  const password = z.string().min(1).max(72).safeParse(form.get("password"));
  return { email, password };
}

function passwordAuthError(error: { code?: string; status?: number }) {
  if (error.code === "email_not_confirmed") return "Invalid email or password.";
  if (error.code === "weak_password") return "Choose a stronger password and try again.";
  if (error.status === 429) return "Too many attempts. Wait a little while before trying again.";
  if (error.code === "invalid_credentials") return "Invalid email or password.";
  return "We couldn’t complete sign-in right now. Please try again.";
}

export async function signInPassword(_: FormState, form: FormData): Promise<FormState> {
  if (!publicConfig()) return { error: "Password sign-in is unavailable." };
  const { email, password } = passwordFormValues(form);
  if (!email.success || !allowedEmail(email.data)) return { error: `Enter a valid @${authorizedDomain()} email address.` };
  if (!password.success) return { error: "Enter your password." };
  const db = await userDb();
  const { data, error } = await db.auth.signInWithPassword({ email: email.data, password: password.data });
  if (error || !data.user) return { error: passwordAuthError(error || {}) };
  if (!data.user.email_confirmed_at || !allowedEmail(data.user.email)) {
    await db.auth.signOut({ scope: "local" });
    return { error: "Invalid email or password." };
  }
  const { data: profile, error: profileError } = await db.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (profileError || !profile || profile.role !== "reviewer") {
    await db.auth.signOut({ scope: "local" });
    return { error: "This workspace is available to authorized reviewers only." };
  }
  redirect(homeFor(profile.role));
}

export async function signUpPassword(_: FormState, _form: FormData): Promise<FormState> {
  return { error: "Account creation is disabled. Contact an authorized E-Club reviewer for access." };
}

export async function signInGoogle() {
  if (!publicConfig() || process.env.GOOGLE_OAUTH_ENABLED !== "true") redirect("/sign-in?error=unavailable");
  const db = await userDb();
  const { data, error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${appUrl()}/auth/callback`, queryParams: { hd: authorizedDomain(), prompt: "select_account" } },
  });
  if (error || !data.url) redirect("/sign-in?error=unavailable");
  redirect(data.url);
}

export async function signOut() {
  const db = await userDb();
  const { error } = await db.auth.signOut({ scope: "local" });
  if (error) throw new Error("sign_out_failed");
  redirect("/sign-in");
}

export async function updateProfile(_: FormState, form: FormData): Promise<FormState> {
  const { db, profile } = await requireSession();
  const values = profileSchema.safeParse({ name: form.get("name"), student_id: form.get("student_id") });
  if (!values.success) return { error: "Enter your name and a valid student ID." };
  const { error } = await db.from("profiles").update(values.data).eq("id", profile.id);
  if (error) return { error: "Your profile could not be saved. Try again." };
  revalidatePath("/profile");
  return { success: "Your profile was saved." };
}

export async function saveProject(id: string | null, _: FormState, form: FormData): Promise<FormState> {
  const { db, profile } = await requireSession("reviewer");
  if (id && !idSchema.safeParse(id).success) return { error: "Project not found." };

  let existing: { rubric_locked_at: string | null; rubric_version: number; questions: string[] } | null = null;
  let lockedRubric: unknown;
  if (id) {
    const { data, error } = await db.from("projects").select("rubric_locked_at,rubric_version,questions")
      .eq("id", id).eq("reviewer_id", profile.id).maybeSingle();
    if (error || !data) return { error: "Project not found." };
    existing = data;
    if (data.rubric_locked_at) {
      const { data: snapshot } = await db.from("project_rubrics").select("criteria,yes_threshold,maybe_threshold")
        .eq("project_id", id).eq("version", data.rubric_version).single();
      if (!snapshot) return { error: "The saved rubric could not be loaded." };
      lockedRubric = snapshot;
    }
  }

  const items = (key: string) => String(form.get(key) || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const deadline = String(form.get("deadline") || "");
  const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(deadline) ? new Date(`${deadline}:00+05:30`) : null;
  const locked = lockedRubric as { criteria: unknown; yes_threshold: number; maybe_threshold: number } | undefined;
  const labels = form.getAll("criterion_label");
  const ids = form.getAll("criterion_id");
  const categories = form.getAll("criterion_category");
  const descriptions = form.getAll("criterion_description");
  const weights = form.getAll("criterion_weight");
  const values = projectSchema.safeParse({
    name: form.get("name"),
    short_description: form.get("short_description"),
    description: form.get("description"),
    requirements: form.get("requirements") || "",
    required_skills: items("required_skills"),
    questions: locked ? existing?.questions : items("questions"),
    deadline: instant && !Number.isNaN(+instant) ? instant.toISOString() : "",
    status: form.get("status"),
    rubric: locked?.criteria ?? labels.map((label, index) => ({
      label, id: ids[index] || crypto.randomUUID(), category: categories[index],
      description: descriptions[index], weight: Number(weights[index]),
    })),
    yes_threshold: locked?.yes_threshold ?? Number(form.get("yes_threshold")),
    maybe_threshold: locked?.maybe_threshold ?? Number(form.get("maybe_threshold")),
  });
  if (!values.success) {
    const fields: Record<string, string> = {
      name: "Project name", short_description: "Short description", description: "Full description", required_skills: "Required skills",
      requirements: "Eligibility requirements", questions: "Applicant questions", deadline: "Application deadline",
      status: "Publish status", rubric: "Screening rubric", yes_threshold: "Yes threshold", maybe_threshold: "Maybe threshold",
    };
    const issue = values.error.issues[0];
    return { error: `${fields[String(issue.path[0])] || "Project"} — ${issue.message}` };
  }
  if (values.data.status === "published" && Date.parse(values.data.deadline) <= Date.now()) {
    return { error: "A published project needs a future deadline. Change the deadline or mark the project closed." };
  }
  if (!relevantCriteria(values.data.rubric)) return { error: "Use project-related qualifications and leave personal characteristics and career gaps out of the rubric." };

  const admin = serviceDb();
  const query = id
    ? admin.from("projects").update(values.data).eq("id", id).eq("reviewer_id", profile.id)
    : admin.from("projects").insert({ ...values.data, reviewer_id: profile.id });
  const { data, error } = await query.select("id").maybeSingle();
  if (error || !data) return { error: databaseMessage(error?.message) };
  revalidatePath("/reviewer");
  revalidatePath("/projects");
  redirect(`/reviewer/${data.id}`);
}

export async function saveDecision(_: FormState, form: FormData): Promise<FormState> {
  const { db, profile } = await requireSession("reviewer");
  const parsed = decisionSchema.safeParse({
    applicationId: form.get("application_id"), version: form.get("version"),
    decision: form.get("decision"), note: form.get("note") ?? "",
  });
  if (!parsed.success) return { error: "Choose a decision and keep the note within 2,000 characters." };
  const { applicationId, version, decision, note } = parsed.data;
  const { data: owned } = await db.from("applications").select("project_id").eq("id", applicationId).maybeSingle();
  if (!owned) return { error: "Application not found." };
  const { data, error } = await serviceDb().rpc("record_decision", {
    p_reviewer: profile.id, p_application: applicationId, p_version: version, p_decision: decision, p_note: note,
  });
  if (error || !data) return { error: "The decision could not be saved. Refresh to check for a newer submission." };
  revalidatePath(`/reviewer/${owned.project_id}`);
  revalidatePath(`/reviewer/${owned.project_id}/applicants/${applicationId}`);
  return { success: "Decision recorded." };
}

export async function retryScreening(_: FormState, form: FormData): Promise<FormState> {
  const { db, profile } = await requireSession("reviewer");
  const parsed = z.object({ id: idSchema, version: z.coerce.number().int().min(1) })
    .safeParse({ id: form.get("application_id"), version: form.get("version") });
  if (!parsed.success) return { error: "Application not found." };
  const { data: owned } = await db.from("applications").select("project_id").eq("id", parsed.data.id).maybeSingle();
  if (!owned) return { error: "Application not found." };
  const { data, error } = await serviceDb().rpc("retry_screening", {
    p_reviewer: profile.id, p_application: parsed.data.id, p_version: parsed.data.version,
  });
  if (error || !data) return { error: "This screening could not be requeued. Refresh for the current status." };
  revalidatePath(`/reviewer/${owned.project_id}`);
  revalidatePath(`/reviewer/${owned.project_id}/applicants/${parsed.data.id}`);
  return { success: "Screening was queued for retry." };
}
