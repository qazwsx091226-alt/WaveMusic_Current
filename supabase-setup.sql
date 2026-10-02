-- =============================================================
-- Wave Music - Supabase Auth / Role Setup
-- Supabase Dashboard > SQL Editor 에서 전체 실행하세요.
-- =============================================================

create type public.app_role as enum ('user', 'admin', 'super_admin');
create type public.account_status as enum ('active', 'suspended');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nickname text not null,
  role public.app_role not null default 'user',
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 회원가입 시 profiles 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nickname, role, status)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nickname'), ''), 'Wave 사용자'),
    'user',
    'active'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- 이미 Auth에 만들어진 사용자가 있다면 profiles에 보충
insert into public.profiles (id, email, nickname, role, status, created_at)
select
  u.id,
  u.email,
  coalesce(nullif(trim(u.raw_user_meta_data ->> 'nickname'), ''), 'Wave 사용자'),
  'user',
  'active',
  u.created_at
from auth.users u
on conflict (id) do nothing;

-- 현재 로그인 사용자의 역할 확인용
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
  limit 1;
$$;

create or replace function public.is_wave_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() in ('admin', 'super_admin'), false);
$$;

create or replace function public.is_wave_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'super_admin', false);
$$;

-- 본인은 본인 정보 조회, 관리자는 전체 조회
create policy "profiles_select_own_or_admin"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or public.is_wave_admin()
);

-- 브라우저에서 profiles 직접 수정은 막고 RPC 함수만 사용
revoke all on table public.profiles from anon;
revoke insert, update, delete on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;

-- 닉네임 변경
create or replace function public.update_my_nickname(new_nickname text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned text := trim(new_nickname);
begin
  if (select auth.uid()) is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if char_length(cleaned) < 2 or char_length(cleaned) > 24 then
    raise exception '닉네임은 2~24자여야 합니다.';
  end if;

  update public.profiles
  set nickname = cleaned,
      updated_at = now()
  where id = (select auth.uid());
end;
$$;

-- 관리자/슈퍼관리자의 계정 상태 변경
-- 일반 관리자는 일반 사용자만 정지/해제할 수 있습니다.
-- 슈퍼관리자는 일반 사용자와 관리자를 정지/해제할 수 있습니다.
-- 슈퍼관리자 계정은 웹 관리자 화면에서 정지할 수 없습니다.
create or replace function public.admin_set_user_status(
  target_user uuid,
  new_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role public.app_role;
  target_role public.app_role;
  parsed_status public.account_status;
begin
  caller_role := public.current_app_role();

  if caller_role not in ('admin', 'super_admin') then
    raise exception '관리자 권한이 필요합니다.';
  end if;

  if target_user = (select auth.uid()) then
    raise exception '자기 계정 상태는 변경할 수 없습니다.';
  end if;

  select p.role into target_role
  from public.profiles p
  where p.id = target_user;

  if target_role is null then
    raise exception '사용자를 찾을 수 없습니다.';
  end if;

  if target_role = 'super_admin' then
    raise exception '슈퍼관리자 계정은 여기서 변경할 수 없습니다.';
  end if;

  if caller_role = 'admin' and target_role <> 'user' then
    raise exception '일반 관리자는 일반 사용자만 관리할 수 있습니다.';
  end if;

  parsed_status := new_status::public.account_status;

  update public.profiles
  set status = parsed_status,
      updated_at = now()
  where id = target_user;
end;
$$;

-- 슈퍼관리자만 user <-> admin 권한 변경 가능
-- super_admin 권한 자체는 웹사이트에서 생성하지 못하게 막았습니다.
create or replace function public.super_set_user_role(
  target_user uuid,
  new_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role public.app_role;
  parsed_role public.app_role;
begin
  if not public.is_wave_super_admin() then
    raise exception '슈퍼관리자 권한이 필요합니다.';
  end if;

  if target_user = (select auth.uid()) then
    raise exception '자기 권한은 변경할 수 없습니다.';
  end if;

  if new_role not in ('user', 'admin') then
    raise exception 'user 또는 admin 권한만 지정할 수 있습니다.';
  end if;

  select p.role into target_role
  from public.profiles p
  where p.id = target_user;

  if target_role is null then
    raise exception '사용자를 찾을 수 없습니다.';
  end if;

  if target_role = 'super_admin' then
    raise exception '다른 슈퍼관리자 권한은 웹사이트에서 변경할 수 없습니다.';
  end if;

  parsed_role := new_role::public.app_role;

  update public.profiles
  set role = parsed_role,
      updated_at = now()
  where id = target_user;
end;
$$;

grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_wave_admin() to authenticated;
grant execute on function public.is_wave_super_admin() to authenticated;
grant execute on function public.update_my_nickname(text) to authenticated;
grant execute on function public.admin_set_user_status(uuid, text) to authenticated;
grant execute on function public.super_set_user_role(uuid, text) to authenticated;

-- =============================================================
-- 첫 슈퍼관리자 만드는 방법
-- 1) 사이트에서 먼저 회원가입을 완료한 뒤
-- 2) 아래 이메일을 본인 이메일로 바꾸고 한 번 실행하세요.
-- =============================================================
-- update public.profiles
-- set role = 'super_admin'
-- where email = 'YOUR_EMAIL@example.com';
