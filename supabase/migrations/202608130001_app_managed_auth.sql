-- Autenticación propia de Impulso IA. Supabase se usa únicamente como Postgres/Storage.
create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(trim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Conserva los IDs y datos de usuarios ya creados por Supabase Auth.
insert into public.app_users (id, email, created_at)
select id, lower(email), created_at
from auth.users
where email is not null
on conflict do nothing;

-- Las tablas de negocio dejan de depender de auth.users.
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles add constraint profiles_id_fkey foreign key (id) references public.app_users(id) on delete cascade;
alter table public.music_tracks drop constraint if exists music_tracks_owner_id_fkey;
alter table public.music_tracks add constraint music_tracks_owner_id_fkey foreign key (owner_id) references public.app_users(id) on delete cascade;
alter table public.publications drop constraint if exists publications_user_id_fkey;
alter table public.publications add constraint publications_user_id_fkey foreign key (user_id) references public.app_users(id) on delete cascade;
alter table public.publications drop constraint if exists publications_approved_by_fkey;
alter table public.publications add constraint publications_approved_by_fkey foreign key (approved_by) references public.app_users(id);
alter table public.tiktok_connections drop constraint if exists tiktok_connections_user_id_fkey;
alter table public.tiktok_connections add constraint tiktok_connections_user_id_fkey foreign key (user_id) references public.app_users(id) on delete cascade;
alter table public.publication_events drop constraint if exists publication_events_actor_id_fkey;
alter table public.publication_events add constraint publication_events_actor_id_fkey foreign key (actor_id) references public.app_users(id);
alter table public.publication_batches drop constraint if exists publication_batches_user_id_fkey;
alter table public.publication_batches add constraint publication_batches_user_id_fkey foreign key (user_id) references public.app_users(id) on delete cascade;

create table if not exists public.app_magic_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.app_refresh_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists app_magic_links_active_idx on public.app_magic_links(token_hash, expires_at) where used_at is null;
create index if not exists app_refresh_sessions_active_idx on public.app_refresh_sessions(token_hash, expires_at) where revoked_at is null;
create index if not exists app_refresh_sessions_user_idx on public.app_refresh_sessions(user_id, created_at desc);

alter table public.app_users enable row level security;
alter table public.app_magic_links enable row level security;
alter table public.app_refresh_sessions enable row level security;

revoke all on table public.app_users, public.app_magic_links, public.app_refresh_sessions from public, anon, authenticated;
grant all on table public.app_users, public.app_magic_links, public.app_refresh_sessions to service_role;

create or replace function public.issue_app_magic_link(
  p_email text,
  p_token_hash text,
  p_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_email text := lower(trim(p_email));
begin
  if v_email is null or v_email = '' or p_token_hash !~ '^[0-9a-f]{64}$' or p_expires_at <= now() then
    raise exception 'Invalid magic link parameters';
  end if;

  insert into public.app_users(email)
  values (v_email)
  on conflict (email) do update set updated_at = now()
  returning public.app_users.id into v_user_id;

  insert into public.profiles(id) values (v_user_id) on conflict (id) do nothing;

  -- Al solicitar uno nuevo, todos los enlaces anteriores del usuario quedan invalidados.
  update public.app_magic_links
  set used_at = now()
  where user_id = v_user_id and used_at is null;

  insert into public.app_magic_links(user_id, token_hash, expires_at)
  values (v_user_id, p_token_hash, p_expires_at);
  return v_user_id;
end;
$$;

create or replace function public.consume_app_magic_link(
  p_token_hash text,
  p_refresh_token_hash text,
  p_refresh_expires_at timestamptz
)
returns table(id uuid, email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  update public.app_magic_links
  set used_at = now()
  where token_hash = p_token_hash
    and used_at is null
    and expires_at > now()
  returning user_id into v_user_id;

  if v_user_id is null then return; end if;
  insert into public.app_refresh_sessions(user_id, token_hash, expires_at)
  values (v_user_id, p_refresh_token_hash, p_refresh_expires_at);
  return query select u.id, u.email from public.app_users u where u.id = v_user_id;
end;
$$;

create or replace function public.rotate_app_refresh_token(
  p_current_token_hash text,
  p_next_token_hash text,
  p_next_expires_at timestamptz
) returns table(id uuid, email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  update public.app_refresh_sessions
  set revoked_at = now()
  where token_hash = p_current_token_hash
    and revoked_at is null
    and expires_at > now()
  returning user_id into v_user_id;

  if v_user_id is null then return; end if;
  insert into public.app_refresh_sessions(user_id, token_hash, expires_at)
  values (v_user_id, p_next_token_hash, p_next_expires_at);
  return query select u.id, u.email from public.app_users u where u.id = v_user_id;
end;
$$;

revoke all on function public.issue_app_magic_link(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_app_magic_link(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.rotate_app_refresh_token(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.issue_app_magic_link(text, text, timestamptz) to service_role;
grant execute on function public.consume_app_magic_link(text, text, timestamptz) to service_role;
grant execute on function public.rotate_app_refresh_token(text, text, timestamptz) to service_role;

drop trigger if exists touch_app_users on public.app_users;
create trigger touch_app_users before update on public.app_users for each row execute function public.touch_updated_at();

comment on table public.app_magic_links is 'Tokens de acceso de un solo uso; solo se almacena SHA-256.';
comment on table public.app_refresh_sessions is 'Sesiones propias de Impulso IA; solo se almacena SHA-256 del refresh token.';
