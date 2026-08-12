create extension if not exists pgcrypto;

create type public.publication_status as enum (
  'generating', 'pending_review', 'approved', 'scheduled',
  'publishing', 'published', 'rejected', 'failed'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'America/Lima',
  posts_per_day smallint not null default 3 check (posts_per_day between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.music_tracks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  storage_path text not null,
  duration_seconds integer not null check (duration_seconds > 0),
  license_notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  theme text not null,
  tone text not null,
  quote text not null default '',
  caption text not null default '',
  hashtags text[] not null default '{}',
  image_prompt text not null default '',
  image_path text,
  video_path text,
  music_track_id uuid references public.music_tracks(id),
  status public.publication_status not null default 'generating',
  scheduled_for timestamptz,
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  published_at timestamptz,
  external_post_id text,
  error_message text,
  generation_metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_requires_approval check (
    status not in ('scheduled', 'publishing', 'published') or approved_at is not null
  )
);

create table public.tiktok_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  open_id text not null,
  display_name text,
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  expires_at timestamptz not null,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.publication_events (
  id bigint generated always as identity primary key,
  publication_id uuid not null references public.publications(id) on delete cascade,
  actor_id uuid references auth.users(id),
  event_type text not null,
  from_status public.publication_status,
  to_status public.publication_status,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index publications_user_status_idx on public.publications(user_id, status);
create index publications_schedule_idx on public.publications(scheduled_for) where status = 'scheduled';
create index publication_events_publication_idx on public.publication_events(publication_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.music_tracks enable row level security;
alter table public.publications enable row level security;
alter table public.tiktok_connections enable row level security;
alter table public.publication_events enable row level security;

create policy "profiles own row" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "music own rows" on public.music_tracks for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "publications own rows" on public.publications for select using (user_id = auth.uid());
create policy "connections own metadata" on public.tiktok_connections for select using (user_id = auth.uid());
create policy "events through owned publication" on public.publication_events for select using (
  exists(select 1 from public.publications p where p.id = publication_id and p.user_id = auth.uid())
);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  ('generated-images', 'generated-images', false, 20971520, array['image/png','image/jpeg','image/webp']),
  ('rendered-videos', 'rendered-videos', false, 104857600, array['video/mp4']),
  ('music', 'music', false, 31457280, array['audio/mpeg','audio/wav','audio/mp4'])
on conflict (id) do nothing;

create policy "users read own generated assets" on storage.objects for select using (
  bucket_id in ('generated-images','rendered-videos','music') and (storage.foldername(name))[1] = auth.uid()::text
);

insert into public.music_tracks(id, owner_id, name, storage_path, duration_seconds, license_notes)
values ('00000000-0000-0000-0000-000000000001', null, 'Inspirational Piano', 'system/inspirational-piano.mp3', 120, 'Replace with a licensed or original track before production')
on conflict (id) do nothing;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger touch_profiles before update on public.profiles for each row execute function public.touch_updated_at();
create trigger touch_publications before update on public.publications for each row execute function public.touch_updated_at();
create trigger touch_tiktok_connections before update on public.tiktok_connections for each row execute function public.touch_updated_at();
