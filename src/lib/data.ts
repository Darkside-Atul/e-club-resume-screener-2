import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { idSchema } from "./schema";
import type { Application, Project, Rubric } from "./types";

export const projectColumns = "id,reviewer_id,name,short_description,description,required_skills,requirements,questions,rubric_version,rubric_locked_at,deadline,status,created_at";

export function deadlinePassed(deadline: string) {
  return Date.parse(deadline) <= Date.now();
}

export function isOpen(project: Pick<Project, "status" | "deadline">) {
  return project.status === "published" && !deadlinePassed(project.deadline);
}

export async function getProject(db: SupabaseClient, id: string, owner?: string) {
  if (!idSchema.safeParse(id).success) notFound();
  let query = db.from("projects").select(projectColumns).eq("id", id);
  if (owner) query = query.eq("reviewer_id", owner);
  else query = query.eq("status", "published").gt("deadline", new Date().toISOString());
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("project_lookup_failed");
  if (!data) notFound();
  return data as Project;
}

export async function getRubric(db: SupabaseClient, projectId: string, version: number) {
  const { data, error } = await db.from("project_rubrics").select("criteria,yes_threshold,maybe_threshold,version")
    .eq("project_id", projectId).eq("version", version).single();
  if (error) throw new Error("rubric_lookup_failed");
  return data as Rubric;
}

export async function getApplication(db: SupabaseClient, projectId: string, applicationId: string) {
  if (!idSchema.safeParse(applicationId).success) notFound();
  const { data, error } = await db.from("applications").select("*")
    .eq("project_id", projectId).eq("id", applicationId).maybeSingle();
  if (error) throw new Error("application_lookup_failed");
  if (!data) notFound();
  return data as Application;
}
