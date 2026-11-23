begin;

alter table public.applications
  add column if not exists source text not null default 'application' check (source in ('application', 'internal_import', 'upload')),
  add column if not exists extra_paths text[] not null default '{}',
  add column if not exists notes text not null default '' check (length(notes) <= 10000),
  add column if not exists profile jsonb not null default '{}'::jsonb check (jsonb_typeof(profile) = 'object');

alter table public.applications drop constraint if exists applications_import_identity;
alter table public.applications add constraint applications_import_identity check (
  (applicant_name is null or length(trim(applicant_name)) between 1 and 100)
  and (applicant_email is null or length(trim(applicant_email)) between 3 and 320)
);

create or replace function public.create_uploaded_candidate(
  p_reviewer uuid, p_project uuid, p_resume_path text, p_extra_paths text[], p_name text,
  p_email text, p_links text[], p_notes text, p_profile jsonb
) returns uuid language plpgsql set search_path = '' as $$
declare project public.projects; ticket public.upload_tickets; application uuid; candidate_email text; candidate_name text;
begin
  if not exists (select 1 from public.profiles where id = p_reviewer and role = 'reviewer') then raise exception 'reviewer_required'; end if;
  select * into project from public.projects where id = p_project and reviewer_id = p_reviewer for update;
  if not found then raise exception 'project_not_found'; end if;
  candidate_email := nullif(lower(trim(coalesce(p_email, p_profile->>'email', ''))), '');
  candidate_name := nullif(trim(coalesce(p_name, p_profile->>'name', '')), '');
  if candidate_email is not null and candidate_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'applicant_invalid'; end if;
  if candidate_email is not null and exists (select 1 from public.applications where project_id = p_project and lower(applicant_email) = candidate_email) then raise exception 'duplicate_applicant'; end if;
  if candidate_name is not null and length(candidate_name) > 100 then raise exception 'applicant_invalid'; end if;
  if cardinality(coalesce(p_links, '{}')) > 5 or exists (select 1 from unnest(coalesce(p_links, '{}')) as l(value) where length(value) > 2048 or value !~ '^https?://') then raise exception 'applicant_invalid'; end if;
  if length(coalesce(p_notes,'')) > 10000 or cardinality(coalesce(p_extra_paths,'{}')) > 3 then raise exception 'applicant_invalid'; end if;
  select * into ticket from public.upload_tickets where path = p_resume_path and user_id = p_reviewer and project_id = p_project for update;
  if not found or ticket.finalized_at is not null or ticket.created_at < clock_timestamp() - interval '20 minutes' then raise exception 'upload_expired'; end if;
  if exists (select 1 from unnest(coalesce(p_extra_paths,'{}')) as x(path) where not exists (
    select 1 from public.upload_tickets t where t.path=x.path and t.user_id=p_reviewer and t.project_id=p_project and t.finalized_at is null and t.created_at >= clock_timestamp() - interval '20 minutes'
  )) then raise exception 'upload_expired'; end if;
  if project.rubric_locked_at is null then update public.projects set rubric_locked_at=clock_timestamp() where id=p_project; end if;
  insert into public.applications(project_id,user_id,applicant_name,applicant_email,applicant_student_id,applicant_interests,resume_path,extra_paths,answers,links,notes,profile,source,rubric_version)
  values(p_project,null,candidate_name,candidate_email,null,'{}',p_resume_path,coalesce(p_extra_paths,'{}'),'{}',coalesce(p_links,'{}'),coalesce(p_notes,''),coalesce(p_profile,'{}'),'upload',project.rubric_version)
  returning id into application;
  update public.upload_tickets set finalized_at=clock_timestamp() where path=p_resume_path or path=any(coalesce(p_extra_paths,'{}'));
  insert into public.screening_jobs(application_id,submission_version) values(application,1);
  return application;
end;
$$;

revoke execute on function public.create_uploaded_candidate(uuid,uuid,text,text[],text,text,text[],text,jsonb) from public, anon, authenticated;
grant execute on function public.create_uploaded_candidate(uuid,uuid,text,text[],text,text,text[],text,jsonb) to service_role;

commit;
