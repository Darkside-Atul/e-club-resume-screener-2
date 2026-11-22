import type { Bucket, Criterion, Decision, ProjectInput } from "./schema";

export interface Profile {
  id: string;
  name: string;
  email: string;
  student_id: string | null;
  role: "applicant" | "reviewer";
}

export type Project = Omit<ProjectInput, "rubric" | "maybe_threshold" | "yes_threshold"> & {
  id: string;
  reviewer_id: string;
  rubric_version: number;
  rubric_locked_at: string | null;
  created_at: string;
};

export interface Rubric {
  criteria: Criterion[];
  yes_threshold: number;
  maybe_threshold: number;
  version: number;
}

export interface Application {
  id: string;
  project_id: string;
  user_id: string | null;
  applicant_name: string | null;
  applicant_email: string | null;
  applicant_student_id: string | null;
  applicant_interests: string[];
  resume_path: string;
  answers: string[];
  links: string[];
  status: "submitted" | "under_review";
  submission_version: number;
  rubric_version: number;
  submitted_at: string;
}

export interface Job {
  id: string;
  application_id: string;
  submission_version: number;
  status: "queued" | "processing" | "completed" | "failed";
  attempts: number;
  error_code: string | null;
  lease_token: string;
}

export interface Evidence {
  criterion_id: string;
  label: string;
  status: "met" | "partial" | "unverified";
  quote: string;
}

export interface Screening {
  score: number;
  bucket: Bucket;
  matched_skills: string[];
  missing_skills: string[];
  summary: string;
  flags: string[];
  criterion_evidence: Evidence[];
  model_version: string;
  rubric_version: number;
}

export interface Review {
  decision: Decision;
  note: string;
  decided_at: string;
  decided_by: string;
  submission_version: number;
}
