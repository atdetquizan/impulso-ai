create table if not exists public.publication_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  theme text not null,
  tone text not null,
  requested_count smallint not null check (requested_count between 2 and 3),
  generated_count smallint not null default 0 check (generated_count between 0 and 3),
  status text not null default 'generating' check (
    status in ('generating', 'pending_review', 'approved', 'scheduled', 'published', 'failed')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.publications
  add column if not exists batch_id uuid references public.publication_batches(id) on delete set null,
  add column if not exists background_image_path text,
  add column if not exists composed_image_path text,
  add column if not exists template_id text not null default 'classic-dark';

update public.publications
set composed_image_path = image_path
where composed_image_path is null and image_path is not null;

create index if not exists publication_batches_user_created_idx
  on public.publication_batches(user_id, created_at desc);

create index if not exists publications_batch_idx
  on public.publications(batch_id, created_at);

alter table public.publication_batches enable row level security;

drop policy if exists "batches own rows" on public.publication_batches;
create policy "batches own rows"
  on public.publication_batches
  for select
  using (user_id = auth.uid());

drop trigger if exists touch_publication_batches on public.publication_batches;
create trigger touch_publication_batches
  before update on public.publication_batches
  for each row execute function public.touch_updated_at();
