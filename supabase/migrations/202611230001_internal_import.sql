begin;

alter table public.applications
  alter column user_id drop not null,
  add column applicant_name text,
  add column applicant_email text,
  add column applicant_student_id text,
  add column applicant_interests text[] not null default '{}';

alter table public.applications
  add constraint applications_import_identity check (
    (applicant_name is null and applicant_email is null)
    or (applicant_name is not null and applicant_email is not null
      and length(trim(applicant_name)) between 1 and 100 and length(trim(applicant_email)) between 3 and 320)
  ),
  add constraint applications_import_student_id check (
    applicant_student_id is null or applicant_student_id ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$'
  ),
  add constraint applications_import_interests check (cardinality(applicant_interests) <= 20);

create unique index applications_project_import_email
  on public.applications (project_id, lower(applicant_email)) where applicant_email is not null;

create or replace function public.begin_internal_resume_upload(p_reviewer uuid, p_project uuid)
returns text language plpgsql set search_path = '' as $$
declare ticket text;
begin
  if not exists (select 1 from public.profiles where id = p_reviewer and role = 'reviewer') then
    raise exception 'reviewer_required';
  end if;
  if not exists (select 1 from public.projects where id = p_project and reviewer_id = p_reviewer) then
    raise exception 'project_not_found';
  end if;
  if (select count(*) from public.upload_tickets where user_id = p_reviewer and created_at > now() - interval '1 hour') >= 300 then
    raise exception 'upload_limit';
  end if;
  ticket := p_project::text || '/' || p_reviewer::text || '/' || gen_random_uuid() || '.pdf';
  insert into public.upload_tickets (path, user_id, project_id) values (ticket, p_reviewer, p_project);
  return ticket;
end;
$$;

create or replace function public.import_applicant(
  p_reviewer uuid, p_project uuid, p_path text, p_name text, p_email text,
  p_student_id text, p_interests text[]
) returns uuid language plpgsql set search_path = '' as $$
declare project public.projects; ticket public.upload_tickets; application uuid;
begin
  if not exists (select 1 from public.profiles where id = p_reviewer and role = 'reviewer') then
    raise exception 'reviewer_required';
  end if;
  select * into project from public.projects where id = p_project and reviewer_id = p_reviewer for update;
  if not found then raise exception 'project_not_found'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 100
    or p_email is null or length(trim(p_email)) not between 3 and 320
    or lower(trim(p_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'applicant_invalid';
  end if;
  if p_student_id is not null and p_student_id !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$' then
    raise exception 'applicant_invalid';
  end if;
  if exists (select 1 from public.applications where project_id = p_project and lower(applicant_email) = lower(trim(p_email))) then
    raise exception 'duplicate_applicant';
  end if;
  if cardinality(coalesce(p_interests, '{}')) > 20 or exists (
    select 1 from unnest(coalesce(p_interests, '{}')) as tags(tag)
    where length(trim(tag)) not between 1 and 80
  ) then raise exception 'applicant_invalid'; end if;
  select * into ticket from public.upload_tickets where path = p_path and user_id = p_reviewer and project_id = p_project for update;
  if not found or ticket.finalized_at is not null or ticket.created_at < clock_timestamp() - interval '20 minutes' then
    raise exception 'upload_expired';
  end if;
  if project.rubric_locked_at is null then
    update public.projects set rubric_locked_at = clock_timestamp() where id = p_project;
  end if;
  insert into public.applications (
    project_id, user_id, applicant_name, applicant_email, applicant_student_id, applicant_interests,
    resume_path, answers, links, rubric_version
  ) values (
    p_project, null, trim(p_name), lower(trim(p_email)), nullif(trim(p_student_id), ''),
    coalesce(p_interests, '{}'), p_path, '{}', '{}', project.rubric_version
  ) returning id into application;
  update public.upload_tickets set finalized_at = clock_timestamp() where path = p_path;
  insert into public.screening_jobs (application_id, submission_version) values (application, 1);
  return application;
end;
$$;

create or replace view public.ranked_applications with (security_invoker = true) as
select a.id, a.project_id, a.submitted_at, a.submission_version,
  coalesce(a.applicant_name, u.name) as name,
  coalesce(a.applicant_email, u.email) as email,
  concat_ws(' ', coalesce(a.applicant_name, u.name), coalesce(a.applicant_email, u.email)) as search_text,
  s.score, s.bucket, s.matched_skills, s.flags, d.decision,
  j.status as job_status, j.error_code,
  case s.bucket when 'Yes' then 1 when 'Maybe' then 2 when 'No' then 3 else 4 end as bucket_order
from public.applications a
left join public.profiles u on u.id = a.user_id
left join public.screenings s on s.application_id = a.id and s.submission_version = a.submission_version
left join public.decisions d on d.application_id = a.id and d.submission_version = a.submission_version
left join public.screening_jobs j on j.application_id = a.id and j.submission_version = a.submission_version
where private.owns_project(a.project_id);

create or replace function public.shortlist_csv_rows(p_project uuid)
returns table (name text, email text, student_id text, project text, score integer,
  bucket public.screening_bucket, matched_skills text[], missing_skills text[], flags text[],
  decision public.review_decision, note text, submitted_at timestamptz, decided_at timestamptz)
language plpgsql stable set search_path = '' as $$
begin
  if not private.owns_project(p_project) then raise exception 'project_not_found'; end if;
  if exists (select 1 from public.projects p where p.id = p_project and p.deadline > now()) then
    raise exception 'export_before_deadline';
  end if;
  return query select coalesce(a.applicant_name, u.name), coalesce(a.applicant_email, u.email),
    coalesce(a.applicant_student_id, u.student_id), p.name, s.score, s.bucket,
    s.matched_skills, s.missing_skills, s.flags, d.decision, d.note, a.submitted_at, d.decided_at
  from public.applications a
  left join public.profiles u on u.id = a.user_id
  join public.projects p on p.id = a.project_id
  join public.decisions d on d.application_id = a.id and d.submission_version = a.submission_version
  left join public.screenings s on s.application_id = a.id and s.submission_version = a.submission_version
  where a.project_id = p_project and d.decision = 'shortlist'
  order by s.score desc nulls last, a.submitted_at, a.id;
end;
$$;

revoke execute on function public.begin_internal_resume_upload(uuid, uuid),
  public.import_applicant(uuid, uuid, text, text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.begin_internal_resume_upload(uuid, uuid),
  public.import_applicant(uuid, uuid, text, text, text, text, text[]) to service_role;

drop policy if exists profile_read on public.profiles;
drop policy if exists profile_update on public.profiles;
drop policy if exists project_read on public.projects;
drop policy if exists application_read on public.applications;
create policy profile_read on public.profiles for select to authenticated using (
  private.has_role('reviewer') and (id = auth.uid() or private.reviews_profile(id))
);
create policy project_read on public.projects for select to authenticated using (private.owns_project(id));
create policy application_read on public.applications for select to authenticated using (private.owns_project(project_id));
revoke update on public.profiles from authenticated;

commit;
