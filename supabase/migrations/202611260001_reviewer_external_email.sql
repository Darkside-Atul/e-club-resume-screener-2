create or replace function private.sync_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email) values (new.id, lower(new.email))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create or replace function private.has_role(target public.account_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = target
  ) and (target = 'reviewer'::public.account_role or private.campus_account());
$$;

drop policy if exists profile_read on public.profiles;
create policy profile_read on public.profiles for select to authenticated
using (
  (id = auth.uid() and (
    private.has_role('reviewer'::public.account_role)
    or private.has_role('applicant'::public.account_role)
  ))
  or private.reviews_profile(id)
);
