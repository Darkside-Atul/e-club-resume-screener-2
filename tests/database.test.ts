import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const db = new PGlite();
const sql = async <T>(statement: string, args: unknown[] = []) => (await db.query<T>(statement, args)).rows;

beforeAll(async () => {
  // PGlite runs PostgreSQL. These definitions reproduce the Auth and Storage
  // interfaces the app migration depends on without running those HTTP services.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    grant usage on schema auth to authenticated;
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create table auth.users (id uuid primary key, email text not null unique, raw_user_meta_data jsonb);
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant all on storage.objects to anon, authenticated;
    create policy sample_permissive_storage on storage.objects for all using (true) with check (true);
  `);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(directory)).sort()) await db.exec(await readFile(new URL(file, directory), "utf8"));
});

afterAll(() => db.close());

const campus = (id: string) => `${id}@ashoka.edu.in`;

async function actor(reviewer = false) {
  const id = randomUUID();
  await sql("insert into auth.users values ($1,$2,$3)", [id, campus(id), { role: "reviewer" }]);
  await sql("update profiles set name=$2, student_id='TEST-1' where id=$1", [id, `Test ${id.slice(0, 5)}`]);
  if (reviewer) await sql("update profiles set role='reviewer' where id=$1", [id]);
  return id;
}

async function as<T>(role: "authenticated" | "anon" | "service_role", id: string | null, statement: string, args: unknown[] = [], email?: string) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(id ? { sub: id, email: email || campus(id) } : {})]);
    return (await tx.query<T>(statement, args)).rows;
  });
}

const service = <T>(statement: string, args: unknown[] = []) => as<T>("service_role", null, statement, args);

const criterion = { category: "must_have", id: "00000000-0000-4000-8000-000000000001", label: "SQL", description: "", weight: 2 };
async function project(reviewer: string) {
  const id = randomUUID();
  await service(`insert into projects (id, reviewer_id, name, short_description, description, required_skills, requirements,
    questions, rubric, deadline, status) values ($1,$2,'Test project','A short description','A longer project description',
    array['SQL'],'',array['Experience?'],$3, now() + interval '1 day','published')`, [id, reviewer, [criterion]]);
  return id;
}

async function ticket(user: string, projectId: string) {
  return (await service<{ path: string }>("select begin_resume_upload($1,$2) as path", [user, projectId]))[0].path;
}

async function submit(user: string, projectId: string, path: string, version: number, answers = ["Designed a SQL report."]) {
  return (await service<{ id: string }>(
    "select submit_resume($1,$2,$3,$4,array['Experience?'],$5,array['https://example.invalid']) as id",
    [user, projectId, path, version, answers],
  ))[0].id;
}

async function scenario() {
  const reviewer = await actor(true);
  const student = await actor();
  const projectId = await project(reviewer);
  const path = await ticket(student, projectId);
  const application = await submit(student, projectId, path, 0);
  return { reviewer, student, projectId, path, application };
}

async function simulateElapsedDeadline(projectId: string, deadline: Date) {
  await db.transaction(async (tx) => {
    await tx.exec("alter table projects disable trigger version_project");
    await tx.query("update projects set deadline=$2, status='closed' where id=$1", [projectId, deadline]);
    await tx.exec("alter table projects enable trigger version_project");
  });
}

type Lease = { id: string; lease_token: string; submission_version: number; attempts: number };
async function claim(application: string) {
  // Isolate existing queued test fixtures while exercising the real claim SQL.
  await sql("update screening_jobs set run_after=now()+interval '1 day' where application_id<>$1 and status='queued'", [application]);
  return service<Lease>("select id,lease_token,submission_version,attempts from claim_screenings(1)");
}

const output = {
  score: 81, matched_skills: ["SQL"], missing_skills: [], summary: "SQL evidence was found.",
  flags: [], criterion_evidence: [], model_version: "test-v1", bucket: "No",
};

function finish(job: Lease, result: typeof output | null, error: string | null = null, retry = false) {
  return service<{ saved: boolean }>("select finish_screening($1,$2,$3,$4,$5) as saved",
    [job.id, job.lease_token, result, error, retry]);
}

describe("campus auth and row-level access", () => {
  it("keeps applicant accounts outside the internal reviewer workspace", async () => {
    const user = await actor();
    expect(await as("authenticated", user, "select role from profiles")).toEqual([]);
    await expect(as("authenticated", user, "update profiles set role='reviewer' where id=$1", [user])).rejects.toThrow(/permission denied/);
    await expect(sql("insert into auth.users (id,email) values ($1,'external@example.invalid')", [randomUUID()]))
      .rejects.toThrow("campus_account_required");
    expect(await as("authenticated", user, "select role from profiles", [], "stale@outside.invalid")).toEqual([]);
  });

  it("isolates other applicants, reviewer projects, rubric, decisions and queue", async () => {
    const { reviewer, student, projectId, application } = await scenario();
    const otherReviewer = await actor(true);
    const otherStudent = await actor();
    expect(await as("authenticated", otherStudent, "select id from applications where id=$1", [application])).toEqual([]);
    expect(await as("authenticated", student, "select id from applications where id=$1", [application])).toEqual([]);
    expect(await as("authenticated", otherReviewer, "select id from projects where id=$1", [projectId])).toEqual([]);
    expect(await as("authenticated", reviewer, "select id from projects where id=$1", [projectId])).toEqual([{ id: projectId }]);
    expect(await as("authenticated", student, "select * from project_rubrics where project_id=$1", [projectId])).toEqual([]);
    for (const table of ["screenings", "screening_jobs", "decisions", "decision_history"]) {
      expect(await as("authenticated", student, `select * from ${table} where application_id=$1`, [application])).toEqual([]);
    }
    expect(await as("authenticated", student, "select * from ranked_applications")).toEqual([]);
    await expect(as("authenticated", student, "select claim_screenings(1)")).rejects.toThrow(/permission denied/);
    await expect(as("authenticated", student, "update projects set status='closed' where id=$1", [projectId])).rejects.toThrow(/permission denied/);
  });

  it("blocks direct resume access even with an unrelated permissive storage policy", async () => {
    await sql("insert into storage.objects values ('resumes','private-test')");
    const user = await actor();
    expect(await as("authenticated", user, "select * from storage.objects where name='private-test'")).toEqual([]);
    expect(await as("anon", null, "select * from storage.objects where name='private-test'")).toEqual([]);
    await expect(as("authenticated", user, "insert into storage.objects values ('resumes','forged')")).rejects.toThrow(/row-level security/);
    expect(await sql("select public,file_size_limit,allowed_mime_types from storage.buckets where id='resumes'"))
      .toEqual([{ public: false, file_size_limit: 10485760, allowed_mime_types: ["application/pdf"] }]);
  });
});

describe("application and queue transactions", () => {
  it("imports applicants without login accounts and freezes the project scoring snapshot", async () => {
    const reviewer = await actor(true);
    const student = await actor();
    const projectId = await project(reviewer);
    const path = (await service<{ path: string }>("select begin_internal_resume_upload($1,$2) as path", [reviewer, projectId]))[0].path;
    const application = (await service<{ id: string }>(
      "select import_applicant($1,$2,$3,$4,$5,$6,$7) as id",
      [reviewer, projectId, path, "Imported Applicant", "imported@example.edu", "STU-1", ["Robotics", "Design"]],
    ))[0].id;
    expect(await service("select user_id,applicant_name,applicant_email,applicant_student_id,applicant_interests from applications where id=$1", [application]))
      .toEqual([{ user_id: null, applicant_name: "Imported Applicant", applicant_email: "imported@example.edu", applicant_student_id: "STU-1", applicant_interests: ["Robotics", "Design"] }]);
    expect(await service("select status from screening_jobs where application_id=$1", [application])).toEqual([{ status: "queued" }]);
    expect(await as("authenticated", reviewer, "select name,email from ranked_applications where id=$1", [application]))
      .toEqual([{ name: "Imported Applicant", email: "imported@example.edu" }]);
    expect(await as("authenticated", student, "select id from applications where id=$1", [application])).toEqual([]);
    await expect(service("select import_applicant($1,$2,$3,$4,$5,$6,$7)",
      [reviewer, projectId, path, "Imported Applicant", "imported@example.edu", "STU-1", ["Robotics"]]))
      .rejects.toThrow("duplicate_applicant");
    await expect(service("update projects set yes_threshold=85 where id=$1", [projectId])).rejects.toThrow("rubric_frozen");
  });

  it("persists rubric versions before the first submission and locks criteria afterwards", async () => {
    const reviewer = await actor(true);
    const student = await actor();
    const projectId = await project(reviewer);
    await service("update projects set yes_threshold=80 where id=$1", [projectId]);
    expect(await as("authenticated", reviewer, "select version,yes_threshold from project_rubrics where project_id=$1 order by version", [projectId]))
      .toEqual([{ version: 1, yes_threshold: 70 }, { version: 2, yes_threshold: 80 }]);
    await submit(student, projectId, await ticket(student, projectId), 0);
    await expect(service("update projects set yes_threshold=85 where id=$1", [projectId])).rejects.toThrow("rubric_frozen");
  });

  it("enforces deadlines when a signed upload ticket was created while the project was open", async () => {
    const reviewer = await actor(true);
    const student = await actor();
    const projectId = await project(reviewer);
    const path = await ticket(student, projectId);
    await sql("update projects set deadline=now()-interval '1 minute' where id=$1", [projectId]);
    await expect(submit(student, projectId, path, 0)).rejects.toThrow("applications_closed");
    await expect(ticket(student, projectId)).rejects.toThrow("applications_closed");
  });

  it("makes repeated finalization idempotent, rejects duplicate initial submissions, and replaces on resubmission", async () => {
    const { student, projectId, application, path } = await scenario();
    expect(await submit(student, projectId, path, 0)).toBe(application);
    const second = await ticket(student, projectId);
    await expect(submit(student, projectId, second, 0)).rejects.toThrow("submission_changed");
    expect(await submit(student, projectId, second, 1, ["Revised answers."])).toBe(application);
    expect(await sql("select resume_path,answers,submission_version from applications where id=$1", [application]))
      .toEqual([{ resume_path: second, answers: ["Revised answers."], submission_version: 2 }]);
    expect(await sql("select status from screening_jobs where application_id=$1 order by submission_version", [application]))
      .toEqual([{ status: "failed" }, { status: "queued" }]);
    expect(await sql("select path from resume_deletions where path=$1", [path])).toEqual([{ path }]);
  });

  it("rejects duplicate claims, abandoned leases, and results for superseded resumes", async () => {
    const { student, projectId, application } = await scenario();
    const [job] = await claim(application);
    expect(await claim(application)).toEqual([]);
    await sql("update screening_jobs set lease_until=now()-interval '1 second' where id=$1", [job.id]);
    const [recovered] = await claim(application);
    expect(recovered.id).toBe(job.id);
    expect(recovered.lease_token).not.toBe(job.lease_token);
    expect(await finish(job, output)).toEqual([{ saved: false }]);
    await submit(student, projectId, await ticket(student, projectId), 1);
    expect(await finish(recovered, output)).toEqual([{ saved: false }]);
    const [replacement] = await claim(application);
    expect(replacement.submission_version).toBe(2);
    expect(await finish(replacement, output)).toEqual([{ saved: true }]);
    expect(await finish(replacement, output)).toEqual([{ saved: false }]);
    expect(await sql("select score,bucket,submission_version,model_version from screenings where application_id=$1", [application]))
      .toEqual([{ score: 81, bucket: "Yes", submission_version: 2, model_version: "test-v1" }]);
  });

  it("retries invalid or timed-out responses once and restricts manual retry to the owner", async () => {
    const { reviewer, application } = await scenario();
    const otherReviewer = await actor(true);
    const [original] = await claim(application);
    await finish(original, null, "invalid_model_output", true);
    expect(await claim(application)).toEqual([]);
    await sql("update screening_jobs set run_after=now() where id=$1", [original.id]);
    const [retry] = await claim(application);
    expect(retry.attempts).toBe(2);
    await finish(retry, null, "model_unavailable", true);
    expect(await sql("select status,error_code from screening_jobs where id=$1", [original.id]))
      .toEqual([{ status: "failed", error_code: "model_unavailable" }]);
    const retryRpc = "select retry_screening($1,$2,1) as allowed";
    expect(await service(retryRpc, [otherReviewer, application])).toEqual([{ allowed: false }]);
    expect(await service(retryRpc, [reviewer, application])).toEqual([{ allowed: true }]);
    expect(await sql("select status from applications where id=$1", [application])).toEqual([{ status: "under_review" }]);
  });

  it("defers rate-limited jobs without spending an attempt and enforces global provider budgets", async () => {
    const { application } = await scenario();
    const [job] = await claim(application);
    expect(await service("select reserve_ai_call(1,1) as next")).toEqual([{ next: null }]);
    const [limit] = await service<{ next: Date }>("select reserve_ai_call(1,1) as next");
    expect(+limit.next).toBeGreaterThan(Date.now());
    const until = new Date(Date.now() + 120000);
    expect(await service("select defer_screening($1,$2,$3,true) as deferred", [job.id, job.lease_token, until]))
      .toEqual([{ deferred: true }]);
    expect(await sql("select status,attempts,error_code from screening_jobs where id=$1", [job.id]))
      .toEqual([{ status: "queued", attempts: 0, error_code: "quota_wait" }]);
    expect(await claim(application)).toEqual([]);
  });

  it("deletes retained records atomically and keeps durable storage cleanup work", async () => {
    const { projectId, application, path } = await scenario();
    await simulateElapsedDeadline(projectId, new Date(Date.now() - 5 * 86400000));
    await service("select prepare_resume_cleanup(1)");
    expect(await sql("select id from applications where id=$1", [application])).toEqual([]);
    expect(await sql("select id from screening_jobs where application_id=$1", [application])).toEqual([]);
    expect(await sql("select path from resume_deletions where path=$1", [path])).toEqual([{ path }]);
  });
});

describe("reviewer decisions, ranking and shortlist export", () => {
  it("ranks screened submissions, filters by bucket and decision, audits overrides and exports only shortlist after deadline", async () => {
    const { reviewer, student, projectId, application } = await scenario();
    const otherReviewer = await actor(true);
    const otherStudent = await actor();
    const second = await submit(otherStudent, projectId, await ticket(otherStudent, projectId), 0);
    const [firstJob] = await claim(application);
    await finish(firstJob, output);
    await sql("update screening_jobs set run_after=now() where application_id=$1", [second]);
    const [secondJob] = await claim(second);
    await finish(secondJob, { ...output, score: 61 });
    const decisionSql = "select record_decision($1,$2,1,$3,$4) as saved";
    expect(await service(decisionSql, [otherReviewer, application, "reject", "wrong reviewer"])).toEqual([{ saved: false }]);
    expect(await service(decisionSql, [reviewer, application, "reject", "initial review"])).toEqual([{ saved: true }]);
    expect(await service(decisionSql, [reviewer, application, "shortlist", "confirmed evidence"])).toEqual([{ saved: true }]);
    expect(await service(decisionSql, [reviewer, second, "hold", "follow-up"])).toEqual([{ saved: true }]);
    expect(await as("authenticated", reviewer,
      "select score,bucket,decision from ranked_applications where project_id=$1 order by bucket_order, score desc", [projectId]))
      .toEqual([{ score: 81, bucket: "Yes", decision: "shortlist" }, { score: 61, bucket: "Maybe", decision: "hold" }]);
    expect(await as("authenticated", reviewer,
      "select score from ranked_applications where project_id=$1 and bucket='Maybe' and decision='hold' and search_text ilike $2", [projectId, `%${campus(otherStudent)}%`]))
      .toEqual([{ score: 61 }]);
    expect(await as("authenticated", reviewer, "select decision,decided_by from decision_history where application_id=$1 order by id", [application]))
      .toEqual([{ decision: "reject", decided_by: reviewer }, { decision: "shortlist", decided_by: reviewer }]);
    expect(await as("authenticated", student, "select decision from decisions where application_id=$1", [application])).toEqual([]);
    const exportSql = "select email,score,decision,note from shortlist_csv_rows($1)";
    await expect(as("authenticated", reviewer, exportSql, [projectId])).rejects.toThrow("export_before_deadline");
    await expect(service("update projects set deadline=now()-interval '1 minute', status='closed' where id=$1", [projectId]))
      .rejects.toThrow("deadline_locked");
    await simulateElapsedDeadline(projectId, new Date(Date.now() - 60000));
    await expect(as("authenticated", otherReviewer, exportSql, [projectId])).rejects.toThrow("project_not_found");
    await expect(as("authenticated", student, exportSql, [projectId])).rejects.toThrow("project_not_found");
    expect(await as("authenticated", reviewer, exportSql, [projectId]))
      .toEqual([{ email: campus(student), score: 81, decision: "shortlist", note: "confirmed evidence" }]);
  });
});
