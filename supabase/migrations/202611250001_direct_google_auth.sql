begin;

alter table public.profiles alter column id set default gen_random_uuid();
alter table public.profiles drop constraint if exists profiles_id_fkey;
drop trigger if exists campus_profile on auth.users;
drop function if exists private.sync_profile();
create unique index if not exists profiles_email_ci_unique on public.profiles (lower(email));
grant usage on schema private to service_role;
grant select on private.settings to service_role;

create or replace function public.register_google_reviewer(p_email text, p_name text)
returns public.profiles
language plpgsql set search_path = '' as $$
declare
  normalized_email text := lower(trim(coalesce(p_email, '')));
  normalized_name text := left(trim(coalesce(p_name, '')), 100);
  saved_profile public.profiles;
begin
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or not exists (
      select 1 from private.settings
      where lower(split_part(normalized_email, '@', 2)) = authorized_domain
        and split_part(normalized_email, '@', 3) = ''
    ) then
    raise exception 'campus_account_required';
  end if;

  insert into public.profiles as existing_profile (email, name, role)
  values (normalized_email, normalized_name, 'reviewer')
  on conflict (lower(email)) do update
    set role = 'reviewer',
        name = case when existing_profile.name = '' then excluded.name else existing_profile.name end
  returning * into saved_profile;

  return saved_profile;
end;
$$;

revoke execute on function public.register_google_reviewer(text, text) from public, anon, authenticated;
grant execute on function public.register_google_reviewer(text, text) to service_role;

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
left join public.screening_jobs j on j.application_id = a.id and j.submission_version = a.submission_version;
grant select on public.ranked_applications to service_role;

create or replace function public.shortlist_csv_rows_for_reviewer(p_reviewer uuid, p_project uuid)
returns table (name text, email text, student_id text, project text, score integer,
  bucket public.screening_bucket, matched_skills text[], missing_skills text[], flags text[],
  decision public.review_decision, note text, submitted_at timestamptz, decided_at timestamptz)
language plpgsql stable set search_path = '' as $$
begin
  if not exists (
    select 1 from public.profiles r
    join public.projects p on p.reviewer_id = r.id
    where r.id = p_reviewer and r.role = 'reviewer' and p.id = p_project
  ) then
    raise exception 'project_not_found';
  end if;
  if exists (select 1 from public.projects p where p.id = p_project and p.deadline > now()) then
    raise exception 'export_before_deadline';
  end if;
  return query
  select coalesce(a.applicant_name, u.name), coalesce(a.applicant_email, u.email),
    coalesce(a.applicant_student_id, u.student_id), p.name, s.score, s.bucket,
    s.matched_skills, s.missing_skills, s.flags, d.decision, d.note, a.submitted_at, d.decided_at
  from public.applications a
  left join public.profiles u on u.id = a.user_id
  join public.projects p on p.id = a.project_id
  join public.decisions d on d.application_id = a.id and d.submission_version = a.submission_version
  left join public.screenings s on s.application_id = a.id and s.submission_version = a.submission_version
  where a.project_id = p_project and p.reviewer_id = p_reviewer and d.decision = 'shortlist'
  order by s.score desc nulls last, a.submitted_at, a.id;
end;
$$;

revoke execute on function public.shortlist_csv_rows_for_reviewer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.shortlist_csv_rows_for_reviewer(uuid, uuid) to service_role;

commit;
